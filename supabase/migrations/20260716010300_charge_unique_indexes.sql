-- ===========================================================================
-- Sprint 1 (Financial integrity) — unique charge indexes + meal exclusivity
--
-- File: 20260716010300_charge_unique_indexes.sql
-- Prerequisite: 20260716010200_charge_immutability_and_cancel.sql
--   (needs charges_enforce_immutability + app.allow_charge_status_update)
--
-- Goals:
--   * Prevent duplicate active charges at the database level.
--   * Safely cancel newer outstanding duplicates before indexing (balance-safe).
--   * Enforce one non-cancelled meal plan per student per term (any meal item).
--   * Do not delete charge rows; cancel status only when safe.
--
-- Indexes:
--   A. (student_id, fee_item_id, term_id) WHERE status <> cancelled AND term_id IS NOT NULL
--   B. (student_id, fee_item_id, academic_year_id) WHERE status <> cancelled AND term_id IS NULL
-- Meal cross-item uniqueness cannot use a simple unique index (needs fee_items),
-- so it is enforced by a BEFORE INSERT/UPDATE trigger.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper: cancel one outstanding duplicate if balance-safe
-- ---------------------------------------------------------------------------
create or replace function public._cancel_duplicate_charge_for_index(
  p_charge_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_school_id  uuid;
  v_status     public.charge_status;
  v_paid       numeric(12, 2);
  v_remaining  numeric(12, 2);
begin
  select c.student_id, c.school_id, c.status
  into v_student_id, v_school_id, v_status
  from public.charges as c
  where c.id = p_charge_id
  for update of c;

  if v_status is null then
    raise exception
      'Cannot create unique charge indexes: charge % not found.',
      p_charge_id;
  end if;

  if v_status = 'cancelled'::public.charge_status then
    return;
  end if;

  if v_status <> 'outstanding'::public.charge_status then
    raise exception
      'Cannot create unique charge indexes: duplicate charge % is not outstanding (status %). Resolve manually first.',
      p_charge_id, v_status;
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments as p
  where p.student_id = v_student_id
    and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status;

  select coalesce(sum(c.amount), 0)
  into v_remaining
  from public.charges as c
  where c.student_id = v_student_id
    and c.school_id = v_school_id
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    )
    and c.id <> p_charge_id;

  if v_paid > v_remaining then
    raise exception
      'Cannot create unique charge indexes: duplicate charge % cannot be cancelled safely. Resolve manually first.',
      p_charge_id;
  end if;

  perform set_config('app.allow_charge_status_update', 'on', true);

  update public.charges as c
  set status = 'cancelled'::public.charge_status
  where c.id = p_charge_id
    and c.status = 'outstanding'::public.charge_status;

  if not found then
    raise exception
      'Cannot create unique charge indexes: failed to cancel duplicate charge %.',
      p_charge_id;
  end if;
end;
$$;

comment on function public._cancel_duplicate_charge_for_index(uuid) is
  'SECURITY DEFINER migration helper: balance-safe cancel of an outstanding duplicate before unique indexes. Not for general app use.';

revoke all on function public._cancel_duplicate_charge_for_index(uuid) from public;
revoke all on function public._cancel_duplicate_charge_for_index(uuid) from anon;
-- Keep execute for the migration owner / postgres; do not grant to authenticated.

-- ---------------------------------------------------------------------------
-- 1. Dedupe term-scoped (student + fee_item + term)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.id
    from public.charges as c
    join (
      select student_id, fee_item_id, term_id
      from public.charges
      where status <> 'cancelled'::public.charge_status
        and term_id is not null
      group by student_id, fee_item_id, term_id
      having count(*) > 1
    ) as d
      on d.student_id = c.student_id
     and d.fee_item_id = c.fee_item_id
     and d.term_id = c.term_id
    where c.status <> 'cancelled'::public.charge_status
      and c.term_id is not null
      and c.id not in (
        select distinct on (student_id, fee_item_id, term_id) id
        from public.charges
        where status <> 'cancelled'::public.charge_status
          and term_id is not null
        order by student_id, fee_item_id, term_id, created_at asc, id asc
      )
    order by c.created_at desc, c.id desc
  loop
    perform public._cancel_duplicate_charge_for_index(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Dedupe year/once-scoped (student + fee_item + year, term null)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.id
    from public.charges as c
    join (
      select student_id, fee_item_id, academic_year_id
      from public.charges
      where status <> 'cancelled'::public.charge_status
        and term_id is null
      group by student_id, fee_item_id, academic_year_id
      having count(*) > 1
    ) as d
      on d.student_id = c.student_id
     and d.fee_item_id = c.fee_item_id
     and d.academic_year_id = c.academic_year_id
    where c.status <> 'cancelled'::public.charge_status
      and c.term_id is null
      and c.id not in (
        select distinct on (student_id, fee_item_id, academic_year_id) id
        from public.charges
        where status <> 'cancelled'::public.charge_status
          and term_id is null
        order by student_id, fee_item_id, academic_year_id, created_at asc, id asc
      )
    order by c.created_at desc, c.id desc
  loop
    perform public._cancel_duplicate_charge_for_index(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Dedupe multiple meal plans per student+term (different fee items)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.id
    from public.charges as c
    join public.fee_items as fi on fi.id = c.fee_item_id
    join (
      select c2.student_id, c2.term_id
      from public.charges as c2
      join public.fee_items as fi2 on fi2.id = c2.fee_item_id
      where c2.status <> 'cancelled'::public.charge_status
        and c2.term_id is not null
        and fi2.category = 'meal'::public.fee_category
      group by c2.student_id, c2.term_id
      having count(*) > 1
    ) as d
      on d.student_id = c.student_id
     and d.term_id = c.term_id
    where c.status <> 'cancelled'::public.charge_status
      and fi.category = 'meal'::public.fee_category
      and c.term_id is not null
      and c.id not in (
        select distinct on (c3.student_id, c3.term_id) c3.id
        from public.charges as c3
        join public.fee_items as fi3 on fi3.id = c3.fee_item_id
        where c3.status <> 'cancelled'::public.charge_status
          and c3.term_id is not null
          and fi3.category = 'meal'::public.fee_category
        order by c3.student_id, c3.term_id, c3.created_at asc, c3.id asc
      )
    order by c.created_at desc, c.id desc
  loop
    perform public._cancel_duplicate_charge_for_index(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Unique indexes for active (non-cancelled) charges
-- ---------------------------------------------------------------------------
create unique index if not exists charges_student_item_term_active_uidx
  on public.charges (student_id, fee_item_id, term_id)
  where status <> 'cancelled'::public.charge_status
    and term_id is not null;

create unique index if not exists charges_student_item_year_active_uidx
  on public.charges (student_id, fee_item_id, academic_year_id)
  where status <> 'cancelled'::public.charge_status
    and term_id is null;

-- ---------------------------------------------------------------------------
-- 5. One meal plan per student per term (any meal fee item)
-- ---------------------------------------------------------------------------
create or replace function public.charges_enforce_one_meal_per_term()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category public.fee_category;
begin
  select fi.category
  into v_category
  from public.fee_items as fi
  where fi.id = new.fee_item_id;

  if v_category is distinct from 'meal'::public.fee_category then
    return new;
  end if;

  if new.status = 'cancelled'::public.charge_status then
    return new;
  end if;

  if new.term_id is null then
    raise exception 'Meal charges require a term.';
  end if;

  if exists (
    select 1
    from public.charges as c
    join public.fee_items as fi on fi.id = c.fee_item_id
    where c.student_id = new.student_id
      and c.term_id = new.term_id
      and c.status <> 'cancelled'::public.charge_status
      and fi.category = 'meal'::public.fee_category
      and c.id is distinct from new.id
  ) then
    raise exception
      'This student already has a meal plan for this term. Cancel that charge first to change it.';
  end if;

  return new;
end;
$$;

comment on function public.charges_enforce_one_meal_per_term() is
  'Enforces one non-cancelled meal charge per student per term across meal fee items.';

drop trigger if exists charges_enforce_one_meal_per_term on public.charges;

create trigger charges_enforce_one_meal_per_term
before insert or update on public.charges
for each row
execute function public.charges_enforce_one_meal_per_term();

-- Migration helper is not needed at runtime; leave function in place for
-- re-runs / support, but do not grant to authenticated.
