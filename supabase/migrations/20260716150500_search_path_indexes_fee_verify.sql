-- ===========================================================================
-- Sprint 4: search_path audit helpers, indexes, fee-schedule unique verify
--
-- File: 20260716150500_search_path_indexes_fee_verify.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fee schedule uniqueness: fail if duplicates; ensure index
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from (
    select 1
    from public.fee_schedules
    group by school_id, fee_item_id, academic_year_id, grade_level_id, term_id
    having count(*) > 1
  ) as d;

  if v_count > 0 then
    raise exception
      'Cannot verify fee_schedules uniqueness: % duplicate natural-key group(s). Resolve manually (see OPERATIONS.md). Do not delete blindly.',
      v_count;
  end if;
end;
$$;

create unique index if not exists fee_schedules_natural_key_uidx
  on public.fee_schedules (
    school_id,
    fee_item_id,
    academic_year_id,
    grade_level_id,
    term_id
  )
  nulls not distinct;

-- ---------------------------------------------------------------------------
-- Helpful lookup indexes (IF NOT EXISTS)
-- ---------------------------------------------------------------------------
create index if not exists guardians_school_phone_norm_idx
  on public.guardians (
    school_id,
    (regexp_replace(coalesce(phone, ''), '\s+', '', 'g'))
  )
  where phone is not null and trim(phone) <> '';

create index if not exists student_guardians_guardian_idx
  on public.student_guardians (guardian_id);

create index if not exists payments_student_status_idx
  on public.payments (student_id, status);

create index if not exists charges_student_status_idx
  on public.charges (student_id, status);

create index if not exists attendance_records_date_idx
  on public.attendance_records (attendance_date);

-- ---------------------------------------------------------------------------
-- Ensure can_manage_students / fee helpers keep search_path (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_students()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role in ('administrator', 'headteacher', 'secretary')
  );
$$;

create or replace function public.current_user_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role = 'administrator'
  );
$$;
