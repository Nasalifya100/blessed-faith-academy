-- ===========================================================================
-- Sprint 4: One current term per school + atomic current switches
--
-- File: 20260716150200_current_term_per_school.sql
--
-- Adds terms.school_id, enforces one is_current term per school,
-- and provides set_current_academic_year / set_current_term RPCs.
-- Does not silently clear conflicts — fails if multiple current terms/school.
-- ===========================================================================

alter table public.terms
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

update public.terms as t
set school_id = ay.school_id
from public.academic_years as ay
where t.academic_year_id = ay.id
  and t.school_id is distinct from ay.school_id;

do $$
begin
  if exists (select 1 from public.terms where school_id is null) then
    raise exception
      'Cannot enforce current-term-per-school: some terms have no school_id after backfill.';
  end if;
end;
$$;

alter table public.terms
  alter column school_id set not null;

create index if not exists terms_school_idx
  on public.terms (school_id);

do $$
declare
  v_sample text;
begin
  select string_agg(format('school %s (%s terms)', school_id, n), '; ')
  into v_sample
  from (
    select ay.school_id, count(*)::text as n
    from public.terms as t
    join public.academic_years as ay on ay.id = t.academic_year_id
    where t.is_current
    group by ay.school_id
    having count(*) > 1
  ) d;

  if v_sample is not null then
    raise exception
      'Cannot create one-current-term-per-school index: multiple current terms exist. Resolve manually first. %',
      v_sample;
  end if;
end;
$$;

-- Keep year-scoped uniqueness; add school-scoped uniqueness.
create unique index if not exists terms_one_current_per_school
  on public.terms (school_id)
  where is_current;

comment on index public.terms_one_current_per_school is
  'At most one term marked is_current per school.';

create unique index if not exists academic_years_one_current_per_school
  on public.academic_years (school_id)
  where is_current;

-- ---------------------------------------------------------------------------
-- Atomic switches (administrator only)
-- ---------------------------------------------------------------------------
create or replace function public.set_current_academic_year(p_year_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_target_school uuid;
begin
  if not public.is_administrator() then
    raise exception 'Only an administrator can change the current academic year.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select ay.school_id
  into v_target_school
  from public.academic_years as ay
  where ay.id = p_year_id
  for update of ay;

  if v_target_school is null then
    raise exception 'Academic year was not found.';
  end if;

  if v_target_school <> v_school_id then
    raise exception 'Academic year belongs to a different school.';
  end if;

  update public.academic_years as ay
  set is_current = false
  where ay.school_id = v_school_id
    and ay.is_current
    and ay.id <> p_year_id;

  update public.academic_years as ay
  set is_current = true
  where ay.id = p_year_id
    and ay.school_id = v_school_id;

  -- Clear current flags on terms outside the new current year.
  update public.terms as t
  set is_current = false
  where t.school_id = v_school_id
    and t.is_current
    and t.academic_year_id <> p_year_id;
end;
$$;

comment on function public.set_current_academic_year(uuid) is
  'Atomically sets the sole current academic year for the caller school. Clears current terms not in that year.';

revoke all on function public.set_current_academic_year(uuid) from public;
revoke all on function public.set_current_academic_year(uuid) from anon;
grant execute on function public.set_current_academic_year(uuid) to authenticated;

create or replace function public.set_current_term(p_term_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_term_school uuid;
  v_year_id uuid;
  v_year_current boolean;
begin
  if not public.is_administrator() then
    raise exception 'Only an administrator can change the current term.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select t.school_id, t.academic_year_id
  into v_term_school, v_year_id
  from public.terms as t
  where t.id = p_term_id
  for update of t;

  if v_term_school is null then
    raise exception 'Term was not found.';
  end if;

  if v_term_school <> v_school_id then
    raise exception 'Term belongs to a different school.';
  end if;

  select ay.is_current
  into v_year_current
  from public.academic_years as ay
  where ay.id = v_year_id;

  if not coalesce(v_year_current, false) then
    raise exception 'Set the term''s academic year as current before making this term current.';
  end if;

  update public.terms as t
  set is_current = false
  where t.school_id = v_school_id
    and t.is_current
    and t.id <> p_term_id;

  update public.terms as t
  set is_current = true
  where t.id = p_term_id
    and t.school_id = v_school_id;
end;
$$;

comment on function public.set_current_term(uuid) is
  'Atomically sets the sole current term for the caller school. Term must belong to the current academic year.';

revoke all on function public.set_current_term(uuid) from public;
revoke all on function public.set_current_term(uuid) from anon;
grant execute on function public.set_current_term(uuid) to authenticated;
