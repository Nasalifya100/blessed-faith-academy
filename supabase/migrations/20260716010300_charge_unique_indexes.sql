-- ===========================================================================
-- Sprint 1 / Financial integrity: unique charge indexes + meal exclusivity
--
-- Prevents duplicate active charges at the database level.
-- Dedupes existing duplicates safely before creating indexes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Dedupe: for term-scoped duplicates (same student, fee_item, term), keep the
-- oldest non-cancelled row; cancel newer outstanding duplicates only when
-- balance-safe. Abort if a duplicate cannot be cancelled safely.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
begin
  for r in
    select c.id, c.student_id, c.school_id, c.created_at
    from public.charges c
    join (
      select student_id, fee_item_id, term_id
      from public.charges
      where status <> 'cancelled'
        and term_id is not null
      group by student_id, fee_item_id, term_id
      having count(*) > 1
    ) d on d.student_id = c.student_id
       and d.fee_item_id = c.fee_item_id
       and d.term_id = c.term_id
    where c.status <> 'cancelled'
      and c.term_id is not null
      and c.id not in (
        select distinct on (student_id, fee_item_id, term_id) id
        from public.charges
        where status <> 'cancelled'
          and term_id is not null
        order by student_id, fee_item_id, term_id, created_at asc, id asc
      )
    order by c.created_at desc
  loop
    if r.id is null then
      continue;
    end if;

    select coalesce(sum(amount), 0) into v_paid
    from public.payments
    where student_id = r.student_id
      and school_id = r.school_id
      and status = 'completed';

    select coalesce(sum(amount), 0) into v_remaining
    from public.charges
    where student_id = r.student_id
      and school_id = r.school_id
      and status not in ('cancelled', 'waived')
      and id <> r.id;

    if v_paid > v_remaining then
      raise exception
        'Cannot create unique charge indexes: duplicate charge % cannot be cancelled safely. Resolve manually first.',
        r.id;
    end if;

    perform set_config('app.allow_charge_status_update', 'on', true);
    update public.charges
    set status = 'cancelled'
    where id = r.id
      and status = 'outstanding';

    if not found then
      raise exception
        'Cannot create unique charge indexes: duplicate charge % is not outstanding. Resolve manually first.',
        r.id;
    end if;
  end loop;

  for r in
    select c.id, c.student_id, c.school_id
    from public.charges c
    join (
      select student_id, fee_item_id, academic_year_id
      from public.charges
      where status <> 'cancelled'
        and term_id is null
      group by student_id, fee_item_id, academic_year_id
      having count(*) > 1
    ) d on d.student_id = c.student_id
       and d.fee_item_id = c.fee_item_id
       and d.academic_year_id = c.academic_year_id
    where c.status <> 'cancelled'
      and c.term_id is null
      and c.id not in (
        select distinct on (student_id, fee_item_id, academic_year_id) id
        from public.charges
        where status <> 'cancelled'
          and term_id is null
        order by student_id, fee_item_id, academic_year_id, created_at asc, id asc
      )
  loop
    select coalesce(sum(amount), 0) into v_paid
    from public.payments
    where student_id = r.student_id
      and school_id = r.school_id
      and status = 'completed';

    select coalesce(sum(amount), 0) into v_remaining
    from public.charges
    where student_id = r.student_id
      and school_id = r.school_id
      and status not in ('cancelled', 'waived')
      and id <> r.id;

    if v_paid > v_remaining then
      raise exception
        'Cannot create unique charge indexes: year duplicate charge % cannot be cancelled safely. Resolve manually first.',
        r.id;
    end if;

    perform set_config('app.allow_charge_status_update', 'on', true);
    update public.charges
    set status = 'cancelled'
    where id = r.id
      and status = 'outstanding';

    if not found then
      raise exception
        'Cannot create unique charge indexes: year duplicate charge % is not outstanding. Resolve manually first.',
        r.id;
    end if;
  end loop;
end;
$$;

-- Term-scoped active charges (tuition, term extras, meal item)
create unique index if not exists charges_student_item_term_active_uidx
  on public.charges (student_id, fee_item_id, term_id)
  where status <> 'cancelled' and term_id is not null;

-- Year / once active charges (year extras, uniforms)
create unique index if not exists charges_student_item_year_active_uidx
  on public.charges (student_id, fee_item_id, academic_year_id)
  where status <> 'cancelled' and term_id is null;

-- ---------------------------------------------------------------------------
-- One non-cancelled meal plan per student per term (any meal fee item)
-- ---------------------------------------------------------------------------
create or replace function public.charges_enforce_one_meal_per_term()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category public.fee_category;
begin
  select category into v_category
  from public.fee_items
  where id = new.fee_item_id;

  if v_category is distinct from 'meal' then
    return new;
  end if;

  if new.status = 'cancelled' then
    return new;
  end if;

  if new.term_id is null then
    raise exception 'Meal charges require a term.';
  end if;

  if exists (
    select 1
    from public.charges c
    join public.fee_items fi on fi.id = c.fee_item_id
    where c.student_id = new.student_id
      and c.term_id = new.term_id
      and c.status <> 'cancelled'
      and fi.category = 'meal'
      and c.id is distinct from new.id
  ) then
    raise exception
      'This student already has a meal plan for this term. Cancel that charge first to change it.';
  end if;

  return new;
end;
$$;

drop trigger if exists charges_enforce_one_meal_per_term on public.charges;
create trigger charges_enforce_one_meal_per_term
before insert or update on public.charges
for each row
execute function public.charges_enforce_one_meal_per_term();
