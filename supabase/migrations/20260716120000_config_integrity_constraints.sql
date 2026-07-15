-- ===========================================================================
-- Sprint 3: Config / catalogue integrity (M5, M6, M7, L1)
--
-- File: 20260716120000_config_integrity_constraints.sql
--
--   L1 — set search_path on set_updated_at
--   M5 — case-insensitive admission number uniqueness
--   M6 — at most one current academic year per school; one current term per year
--   M7 — unique fee_schedules natural key (NULLS NOT DISTINCT)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- L1: Harden set_updated_at search_path
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- M5: Case-insensitive admission numbers
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.students
    group by school_id, lower(admission_number)
    having count(*) > 1
  ) then
    raise exception
      'Cannot create case-insensitive admission uniqueness: duplicate admission numbers that differ only by case exist. Resolve them first.';
  end if;
end;
$$;

alter table public.students
  drop constraint if exists students_school_id_admission_number_key;

create unique index if not exists students_school_admission_number_lower_uidx
  on public.students (school_id, lower(admission_number));

comment on index public.students_school_admission_number_lower_uidx is
  'Admission numbers are unique per school ignoring case (BFA-1 and bfa-1 conflict).';

-- ---------------------------------------------------------------------------
-- M6: Single current academic year / term
-- ---------------------------------------------------------------------------
-- Clear extra current years (keep the most recently updated per school).
with ranked as (
  select
    id,
    row_number() over (
      partition by school_id
      order by updated_at desc nulls last, created_at desc nulls last, id
    ) as rn
  from public.academic_years
  where is_current
)
update public.academic_years as ay
set is_current = false
from ranked as r
where ay.id = r.id
  and r.rn > 1;

create unique index if not exists academic_years_one_current_per_school
  on public.academic_years (school_id)
  where is_current;

comment on index public.academic_years_one_current_per_school is
  'At most one academic year marked is_current per school.';

-- Clear extra current terms (keep the most recently updated per year).
with ranked as (
  select
    id,
    row_number() over (
      partition by academic_year_id
      order by updated_at desc nulls last, created_at desc nulls last, id
    ) as rn
  from public.terms
  where is_current
)
update public.terms as t
set is_current = false
from ranked as r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists terms_one_current_per_year
  on public.terms (academic_year_id)
  where is_current;

comment on index public.terms_one_current_per_year is
  'At most one term marked is_current per academic year.';

-- ---------------------------------------------------------------------------
-- M7: Unique fee schedule natural key
--     (school, item, year, grade?, term?) — nulls equal for uniqueness
-- ---------------------------------------------------------------------------
-- Prefer keeping an active row, then the newest.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        school_id,
        fee_item_id,
        academic_year_id,
        grade_level_id,
        term_id
      order by
        is_active desc,
        updated_at desc nulls last,
        created_at desc nulls last,
        id
    ) as rn
  from public.fee_schedules
)
delete from public.fee_schedules as fs
using ranked as r
where fs.id = r.id
  and r.rn > 1;

create unique index if not exists fee_schedules_natural_key_uidx
  on public.fee_schedules (
    school_id,
    fee_item_id,
    academic_year_id,
    grade_level_id,
    term_id
  )
  nulls not distinct;

comment on index public.fee_schedules_natural_key_uidx is
  'One schedule amount per fee item / year / grade / term (null grade or term means the all-grades or annual row).';
