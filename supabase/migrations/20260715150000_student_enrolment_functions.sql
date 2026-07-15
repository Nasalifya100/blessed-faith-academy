-- ===========================================================================
-- Phase 3b: Enrolment helper functions
--
-- Adds the database logic used when adding a student:
--   * schools.admission_prefix  - configurable per-school code (not hardcoded)
--   * suggest_admission_number() - proposes the next admission number
--   * create_enrolled_student()  - creates a student + guardians + class
--                                  placement in ONE transaction (all-or-nothing)
--
-- Both functions run as the calling user (SECURITY INVOKER), so Row Level
-- Security still applies to every insert.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Per-school admission-number prefix. Stored as data (configurable) rather
-- than hardcoded in the app. Blessed Faith Academy uses "BFA".
-- ---------------------------------------------------------------------------
alter table public.schools
  add column if not exists admission_prefix text;

update public.schools
set admission_prefix = 'BFA'
where name = 'Blessed Faith Academy'
  and admission_prefix is null;

-- ---------------------------------------------------------------------------
-- Suggest the next admission number, e.g. "BFA-2026-0001".
-- Format: <prefix>-<current academic year>-<4-digit sequence>. The sequence
-- is one more than the highest existing number that matches this pattern for
-- the school. The suggestion is only a convenience; staff can type over it,
-- and the unique constraint on (school_id, admission_number) is the real guard.
-- ---------------------------------------------------------------------------
create or replace function public.suggest_admission_number()
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_prefix    text;
  v_year      text;
  v_head      text;  -- the "<prefix>-<year>" (or just "<year>") portion
  v_seq       int;
begin
  if v_school_id is null then
    return null;
  end if;

  select coalesce(admission_prefix, '') into v_prefix
  from public.schools where id = v_school_id;

  select name into v_year
  from public.academic_years
  where school_id = v_school_id and is_current
  limit 1;

  if v_year is null then
    v_year := to_char(current_date, 'YYYY');
  end if;

  v_head := case when v_prefix = '' then v_year else v_prefix || '-' || v_year end;

  select coalesce(max((regexp_replace(admission_number, '^.*-', ''))::int), 0) + 1
  into v_seq
  from public.students
  where school_id = v_school_id
    and admission_number ~ ('^' || v_head || '-[0-9]+$');

  return v_head || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Create an ENROLLED student together with their guardians and class
-- placement, all in one transaction. If any step fails (e.g. duplicate
-- admission number), the whole thing is rolled back so no partial data is left.
--
-- p_guardians is a JSON array; each element looks like:
--   {
--     "first_name": "...", "last_name": "...",
--     "phone": "...", "alt_phone": "...", "email": "...",
--     "national_id": "...", "occupation": "...", "address": "...",
--     "relationship": "father|mother|guardian|grandparent|other",
--     "is_primary_contact": true, "is_emergency_contact": false
--   }
-- Returns the new student's id.
-- ---------------------------------------------------------------------------
create or replace function public.create_enrolled_student(
  p_admission_number text,
  p_first_name       text,
  p_middle_name      text,
  p_last_name        text,
  p_date_of_birth    date,
  p_gender           public.gender,
  p_enrollment_date  date,
  p_class_id         uuid,
  p_guardians        jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_student_id       uuid;
  v_academic_year_id uuid;
  v_guardian         jsonb;
  v_guardian_id      uuid;
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to enrol students.';
  end if;

  -- The academic year comes from the chosen class so the two always match.
  select academic_year_id into v_academic_year_id
  from public.classes
  where id = p_class_id and school_id = v_school_id;

  if v_academic_year_id is null then
    raise exception 'The selected class was not found.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status, enrollment_date
  ) values (
    v_school_id, p_admission_number, p_first_name, nullif(p_middle_name, ''),
    p_last_name, p_date_of_birth, p_gender, 'enrolled',
    coalesce(p_enrollment_date, current_date)
  )
  returning id into v_student_id;

  for v_guardian in
    select * from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb))
  loop
    insert into public.guardians (
      school_id, first_name, last_name, phone, alt_phone, email,
      national_id, occupation, address
    ) values (
      v_school_id,
      v_guardian->>'first_name',
      v_guardian->>'last_name',
      nullif(v_guardian->>'phone', ''),
      nullif(v_guardian->>'alt_phone', ''),
      nullif(v_guardian->>'email', ''),
      nullif(v_guardian->>'national_id', ''),
      nullif(v_guardian->>'occupation', ''),
      nullif(v_guardian->>'address', '')
    )
    returning id into v_guardian_id;

    insert into public.student_guardians (
      school_id, student_id, guardian_id, relationship,
      is_primary_contact, is_emergency_contact
    ) values (
      v_school_id,
      v_student_id,
      v_guardian_id,
      (v_guardian->>'relationship')::public.guardian_relationship,
      coalesce((v_guardian->>'is_primary_contact')::boolean, false),
      coalesce((v_guardian->>'is_emergency_contact')::boolean, false)
    );
  end loop;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status, enrolled_on
  ) values (
    v_school_id, v_student_id, p_class_id, v_academic_year_id, 'active',
    coalesce(p_enrollment_date, current_date)
  );

  return v_student_id;
end;
$$;
