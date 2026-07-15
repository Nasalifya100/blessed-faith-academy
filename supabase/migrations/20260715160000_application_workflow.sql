-- ===========================================================================
-- Phase 3d: Application workflow (submit -> review -> approve/reject)
--
-- Adds:
--   * applications.applied_class_id   - the class/grade the child applies for
--   * can_review_applications()       - only administrators & headteachers
--   * create_application()            - registers an applicant (student in
--                                       'applicant' status) + guardians + a
--                                       submitted application, in one transaction
--   * approve_application()           - enrols the applicant into a class
--   * reject_application()            - records a rejection
--
-- Roles:
--   * Administrators, headteachers, secretaries can CREATE applications.
--   * Only administrators and headteachers can APPROVE or REJECT.
--
-- All functions run as the caller (SECURITY INVOKER) so RLS still applies, and
-- each does its work in a single transaction (all-or-nothing).
-- ===========================================================================

-- The grade/class the child is applying for (confirmed or changed at approval).
alter table public.applications
  add column if not exists applied_class_id uuid
    references public.classes(id) on delete set null;

-- ---------------------------------------------------------------------------
-- May the current user approve/reject applications?
-- ---------------------------------------------------------------------------
create or replace function public.can_review_applications()
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
      and role in ('administrator', 'headteacher')
  );
$$;

-- ---------------------------------------------------------------------------
-- Register a new applicant: creates the student (status 'applicant'), their
-- guardians, and a SUBMITTED application. No class enrolment happens yet; that
-- is created when the application is approved. Returns the application id.
-- ---------------------------------------------------------------------------
create or replace function public.create_application(
  p_admission_number  text,
  p_first_name        text,
  p_middle_name       text,
  p_last_name         text,
  p_date_of_birth     date,
  p_gender            public.gender,
  p_applied_class_id  uuid,
  p_consent_agreed    boolean,
  p_consent_signed_by text,
  p_consent_signed_at date,
  p_guardians         jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id     uuid := public.current_user_school_id();
  v_student_id    uuid;
  v_application_id uuid;
  v_guardian      jsonb;
  v_guardian_id   uuid;
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to create applications.';
  end if;

  if p_applied_class_id is not null and not exists (
    select 1 from public.classes
    where id = p_applied_class_id and school_id = v_school_id
  ) then
    raise exception 'The selected class was not found.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status
  ) values (
    v_school_id, p_admission_number, p_first_name, nullif(p_middle_name, ''),
    p_last_name, p_date_of_birth, p_gender, 'applicant'
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

  insert into public.applications (
    school_id, student_id, status, submitted_at, submitted_by,
    applied_class_id, consent_agreed, consent_signed_by, consent_signed_at
  ) values (
    v_school_id, v_student_id, 'submitted', now(), auth.uid(),
    p_applied_class_id, coalesce(p_consent_agreed, false),
    nullif(p_consent_signed_by, ''), p_consent_signed_at
  )
  returning id into v_application_id;

  return v_application_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve an application: enrol the applicant into a class (defaults to the
-- class they applied for), mark them 'enrolled', and stamp the review.
-- Returns the student id.
-- ---------------------------------------------------------------------------
create or replace function public.approve_application(
  p_application_id uuid,
  p_class_id       uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_student_id       uuid;
  v_applied_class_id uuid;
  v_class_id         uuid;
  v_academic_year_id uuid;
  v_status           public.application_status;
begin
  if not public.can_review_applications() then
    raise exception 'You are not authorized to approve applications.';
  end if;

  select student_id, applied_class_id, status
  into v_student_id, v_applied_class_id, v_status
  from public.applications
  where id = p_application_id and school_id = v_school_id;

  if v_student_id is null then
    raise exception 'Application was not found.';
  end if;

  if v_status not in ('submitted', 'draft') then
    raise exception 'Only submitted applications can be approved.';
  end if;

  v_class_id := coalesce(p_class_id, v_applied_class_id);
  if v_class_id is null then
    raise exception 'Please choose a class to enrol the student into.';
  end if;

  select academic_year_id into v_academic_year_id
  from public.classes
  where id = v_class_id and school_id = v_school_id;

  if v_academic_year_id is null then
    raise exception 'The selected class was not found.';
  end if;

  update public.students
  set status = 'enrolled', enrollment_date = current_date
  where id = v_student_id;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status, enrolled_on
  ) values (
    v_school_id, v_student_id, v_class_id, v_academic_year_id, 'active',
    current_date
  );

  update public.applications
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_application_id;

  return v_student_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reject an application: record the decision and mark the student 'rejected'.
-- ---------------------------------------------------------------------------
create or replace function public.reject_application(
  p_application_id uuid,
  p_notes          text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id  uuid := public.current_user_school_id();
  v_student_id uuid;
  v_status     public.application_status;
begin
  if not public.can_review_applications() then
    raise exception 'You are not authorized to reject applications.';
  end if;

  select student_id, status
  into v_student_id, v_status
  from public.applications
  where id = p_application_id and school_id = v_school_id;

  if v_student_id is null then
    raise exception 'Application was not found.';
  end if;

  if v_status not in ('submitted', 'draft') then
    raise exception 'Only submitted applications can be rejected.';
  end if;

  update public.applications
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
      decision_notes = nullif(p_notes, '')
  where id = p_application_id;

  update public.students
  set status = 'rejected'
  where id = v_student_id;
end;
$$;
