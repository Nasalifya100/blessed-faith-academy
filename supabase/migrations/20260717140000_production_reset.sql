-- ===========================================================================
-- Production Reset — clear test operational data, preserve config/staff/auth
--
-- File: 20260717140000_production_reset.sql
--
-- Creates:
--   * system_reset_audits (append-only reset event log; no student_id)
--   * reset_bfa_operational_data(p_dry_run, p_school_name, p_confirmation)
--
-- NEVER touches: schools, academic_years, terms, grade_levels, classes,
-- profiles, auth.users, fee_items, fee_schedules, requirement_items,
-- school_rules, RLS definitions, or migrations.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. System reset audit (not student-linked)
-- ---------------------------------------------------------------------------
create table if not exists public.system_reset_audits (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete restrict,
  actor_id    uuid references public.profiles(id) on delete set null,
  dry_run     boolean not null default false,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists system_reset_audits_school_idx
  on public.system_reset_audits (school_id, created_at desc);

alter table public.system_reset_audits enable row level security;

drop policy if exists "system_reset_audits_select" on public.system_reset_audits;
create policy "system_reset_audits_select"
  on public.system_reset_audits
  for select
  to authenticated
  using (
    public.is_administrator()
    and school_id = public.current_user_school_id()
  );

revoke insert, update, delete on table public.system_reset_audits from anon, authenticated;
grant select on table public.system_reset_audits to authenticated;

comment on table public.system_reset_audits is
  'Append-only log of Production Reset dry-runs/executes. Written only by reset_bfa_operational_data.';

-- ---------------------------------------------------------------------------
-- 2. Reset RPC
-- ---------------------------------------------------------------------------
create or replace function public.reset_bfa_operational_data(
  p_dry_run      boolean default true,
  p_school_name  text default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_actor_id  uuid := auth.uid();
  v_school_name text;
  v_counts jsonb;
  v_deleted jsonb;
  v_preserved jsonb;
  v_validation jsonb;
  v_n bigint;
  c_attendance_audits bigint;
  c_attendance bigint;
  c_discipline bigint;
  c_req_checks bigint;
  c_medical bigint;
  c_applications bigint;
  c_enrolments bigint;
  c_student_guardians bigint;
  c_payments bigint;
  c_charges bigint;
  c_legacy_audits bigint;
  c_students bigint;
  c_guardians bigint;
  c_covers bigint;
  p_profiles bigint;
  p_years bigint;
  p_terms bigint;
  p_grades bigint;
  p_classes bigint;
  p_fee_items bigint;
  p_fee_schedules bigint;
  p_req_items bigint;
  p_rules bigint;
  p_schools bigint;
begin
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  if not public.is_administrator() then
    raise exception 'Only an Administrator may run Production Reset.';
  end if;

  if coalesce(trim(p_school_name), '') is distinct from 'Blessed Faith Academy' then
    raise exception 'School name confirmation is incorrect.';
  end if;

  if coalesce(trim(p_confirmation), '') is distinct from 'RESET BFA PRODUCTION DATA' then
    raise exception 'Confirmation phrase is incorrect.';
  end if;

  select s.name into v_school_name
  from public.schools as s
  where s.id = v_school_id;

  if v_school_name is distinct from 'Blessed Faith Academy' then
    raise exception 'This reset is only configured for Blessed Faith Academy.';
  end if;

  -- Counts scoped to this school (operational)
  select count(*) into c_attendance_audits
  from public.attendance_record_audits where school_id = v_school_id;

  select count(*) into c_attendance
  from public.attendance_records where school_id = v_school_id;

  select count(*) into c_discipline
  from public.discipline_incidents where school_id = v_school_id;

  select count(*) into c_req_checks
  from public.student_requirement_checks where school_id = v_school_id;

  select count(*) into c_medical
  from public.student_medical where school_id = v_school_id;

  select count(*) into c_applications
  from public.applications where school_id = v_school_id;

  select count(*) into c_enrolments
  from public.student_class_enrollments where school_id = v_school_id;

  select count(*) into c_student_guardians
  from public.student_guardians where school_id = v_school_id;

  select count(*) into c_payments
  from public.payments where school_id = v_school_id;

  select count(*) into c_charges
  from public.charges where school_id = v_school_id;

  select count(*) into c_legacy_audits
  from public.legacy_migration_audits where school_id = v_school_id;

  select count(*) into c_students
  from public.students where school_id = v_school_id;

  select count(*) into c_guardians
  from public.guardians where school_id = v_school_id;

  select count(*) into c_covers
  from public.class_attendance_covers where school_id = v_school_id;

  -- Preserved counts
  select count(*) into p_schools from public.schools where id = v_school_id;
  select count(*) into p_profiles from public.profiles where school_id = v_school_id;
  select count(*) into p_years from public.academic_years where school_id = v_school_id;
  select count(*) into p_terms from public.terms where school_id = v_school_id;
  select count(*) into p_grades from public.grade_levels where school_id = v_school_id;
  select count(*) into p_classes from public.classes where school_id = v_school_id;
  select count(*) into p_fee_items from public.fee_items where school_id = v_school_id;
  select count(*) into p_fee_schedules from public.fee_schedules where school_id = v_school_id;
  select count(*) into p_req_items from public.requirement_items where school_id = v_school_id;
  select count(*) into p_rules from public.school_rules where school_id = v_school_id;

  v_counts := jsonb_build_object(
    'attendance_record_audits', c_attendance_audits,
    'attendance_records', c_attendance,
    'discipline_incidents', c_discipline,
    'student_requirement_checks', c_req_checks,
    'student_medical', c_medical,
    'applications', c_applications,
    'student_class_enrollments', c_enrolments,
    'student_guardians', c_student_guardians,
    'payments', c_payments,
    'charges', c_charges,
    'legacy_migration_audits', c_legacy_audits,
    'students', c_students,
    'guardians', c_guardians,
    'class_attendance_covers', c_covers
  );

  v_preserved := jsonb_build_object(
    'schools', p_schools,
    'profiles', p_profiles,
    'academic_years', p_years,
    'terms', p_terms,
    'grade_levels', p_grades,
    'classes', p_classes,
    'fee_items', p_fee_items,
    'fee_schedules', p_fee_schedules,
    'requirement_items', p_req_items,
    'school_rules', p_rules
  );

  if p_dry_run then
    insert into public.system_reset_audits (school_id, actor_id, dry_run, payload)
    values (
      v_school_id,
      v_actor_id,
      true,
      jsonb_build_object(
        'event', 'production_reset_dry_run',
        'to_delete', v_counts,
        'preserved', v_preserved,
        'storage_candidates', '[]'::jsonb,
        'storage_note', 'No linked storage buckets discovered in schema.'
      )
    );

    return jsonb_build_object(
      'mode', 'dry_run',
      'to_delete', v_counts,
      'preserved', v_preserved,
      'storage_candidates', '[]'::jsonb,
      'storage_note', 'No linked storage buckets discovered in schema.'
    );
  end if;

  -- EXECUTE — deletion order (children before parents / RESTRICT deps first)
  delete from public.attendance_record_audits where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_attendance_audits := v_n;

  delete from public.attendance_records where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_attendance := v_n;

  delete from public.discipline_incidents where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_discipline := v_n;

  delete from public.student_requirement_checks where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_req_checks := v_n;

  delete from public.student_medical where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_medical := v_n;

  delete from public.applications where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_applications := v_n;

  delete from public.student_class_enrollments where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_enrolments := v_n;

  delete from public.student_guardians where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_student_guardians := v_n;

  delete from public.payments where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_payments := v_n;

  delete from public.charges where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_charges := v_n;

  delete from public.legacy_migration_audits where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_legacy_audits := v_n;

  delete from public.students where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_students := v_n;

  delete from public.guardians where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_guardians := v_n;

  delete from public.class_attendance_covers where school_id = v_school_id;
  get diagnostics v_n = row_count;
  c_covers := v_n;

  v_deleted := jsonb_build_object(
    'attendance_record_audits', c_attendance_audits,
    'attendance_records', c_attendance,
    'discipline_incidents', c_discipline,
    'student_requirement_checks', c_req_checks,
    'student_medical', c_medical,
    'applications', c_applications,
    'student_class_enrollments', c_enrolments,
    'student_guardians', c_student_guardians,
    'payments', c_payments,
    'charges', c_charges,
    'legacy_migration_audits', c_legacy_audits,
    'students', c_students,
    'guardians', c_guardians,
    'class_attendance_covers', c_covers
  );

  -- Re-count preserved after wipe (must still be present)
  select count(*) into p_profiles from public.profiles where school_id = v_school_id;
  select count(*) into p_years from public.academic_years where school_id = v_school_id;
  select count(*) into p_terms from public.terms where school_id = v_school_id;
  select count(*) into p_grades from public.grade_levels where school_id = v_school_id;
  select count(*) into p_classes from public.classes where school_id = v_school_id;
  select count(*) into p_fee_items from public.fee_items where school_id = v_school_id;
  select count(*) into p_fee_schedules from public.fee_schedules where school_id = v_school_id;
  select count(*) into p_req_items from public.requirement_items where school_id = v_school_id;
  select count(*) into p_rules from public.school_rules where school_id = v_school_id;
  select count(*) into p_schools from public.schools where id = v_school_id;

  v_preserved := jsonb_build_object(
    'schools', p_schools,
    'profiles', p_profiles,
    'academic_years', p_years,
    'terms', p_terms,
    'grade_levels', p_grades,
    'classes', p_classes,
    'fee_items', p_fee_items,
    'fee_schedules', p_fee_schedules,
    'requirement_items', p_req_items,
    'school_rules', p_rules
  );

  -- Validation: operational must be zero; config/staff must remain
  select count(*) into c_students from public.students where school_id = v_school_id;
  select count(*) into c_applications from public.applications where school_id = v_school_id;
  select count(*) into c_guardians from public.guardians where school_id = v_school_id;
  select count(*) into c_charges from public.charges where school_id = v_school_id;
  select count(*) into c_payments from public.payments where school_id = v_school_id;
  select count(*) into c_attendance from public.attendance_records where school_id = v_school_id;
  select count(*) into c_discipline from public.discipline_incidents where school_id = v_school_id;

  if c_students <> 0
     or c_applications <> 0
     or c_guardians <> 0
     or c_charges <> 0
     or c_payments <> 0
     or c_attendance <> 0
     or c_discipline <> 0 then
    raise exception 'Post-reset validation failed: operational data remains.';
  end if;

  if p_profiles < 1 or p_schools < 1 or p_years < 1 or p_classes < 1 then
    raise exception 'Post-reset validation failed: required configuration or staff missing.';
  end if;

  v_validation := jsonb_build_object(
    'students', c_students,
    'applications', c_applications,
    'guardians', c_guardians,
    'charges', c_charges,
    'payments', c_payments,
    'attendance_records', c_attendance,
    'discipline_incidents', c_discipline,
    'staff_profiles', p_profiles,
    'schools', p_schools,
    'academic_years', p_years,
    'classes', p_classes,
    'fee_items', p_fee_items,
    'school_rules', p_rules,
    'ok', true
  );

  insert into public.system_reset_audits (school_id, actor_id, dry_run, payload)
  values (
    v_school_id,
    v_actor_id,
    false,
    jsonb_build_object(
      'event', 'production_reset_executed',
      'deleted', v_deleted,
      'preserved', v_preserved,
      'validation', v_validation,
      'storage_candidates', '[]'::jsonb
    )
  );

  return jsonb_build_object(
    'mode', 'executed',
    'deleted', v_deleted,
    'preserved', v_preserved,
    'validation', v_validation,
    'storage_candidates', '[]'::jsonb,
    'storage_note', 'No linked storage buckets discovered in schema.',
    'reminder', 'Set ALLOW_PRODUCTION_RESET=false and redeploy after this reset.'
  );
end;
$$;

comment on function public.reset_bfa_operational_data(boolean, text, text) is
  'Administrator-only Production Reset. Dry-run counts by default; execute deletes operational data in FK-safe order. Preserves staff, auth, academic and fee configuration.';

revoke all on function public.reset_bfa_operational_data(boolean, text, text) from public;
revoke all on function public.reset_bfa_operational_data(boolean, text, text) from anon;
grant execute on function public.reset_bfa_operational_data(boolean, text, text) to authenticated;
