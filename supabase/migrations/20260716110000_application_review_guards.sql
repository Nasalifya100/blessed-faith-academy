-- ===========================================================================
-- Sprint 3 (Workflow integrity): tighten application approve / reject
--
-- File: 20260716110000_application_review_guards.sql
--
-- - Approve only status = submitted (not draft)
-- - Require consent_agreed = true
-- - Require at least one guardian linked to the student
-- - Require a non-empty class
-- - Reject only submitted applications with a non-empty reason
-- ===========================================================================

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
  v_consent          boolean;
  v_guardian_count   int;
begin
  if not public.can_review_applications() then
    raise exception 'You are not authorized to approve applications.';
  end if;

  select a.student_id, a.applied_class_id, a.status, a.consent_agreed
  into v_student_id, v_applied_class_id, v_status, v_consent
  from public.applications as a
  where a.id = p_application_id
    and a.school_id = v_school_id
  for update of a;

  if v_student_id is null then
    raise exception 'Application was not found.';
  end if;

  if v_status <> 'submitted'::public.application_status then
    raise exception 'Only submitted applications can be approved.';
  end if;

  if coalesce(v_consent, false) is not true then
    raise exception 'Cannot approve: parent/guardian consent is missing.';
  end if;

  select count(*)::int
  into v_guardian_count
  from public.student_guardians as sg
  where sg.student_id = v_student_id
    and sg.school_id = v_school_id;

  if v_guardian_count < 1 then
    raise exception 'Cannot approve: at least one guardian is required.';
  end if;

  v_class_id := coalesce(p_class_id, v_applied_class_id);
  if v_class_id is null then
    raise exception 'Please choose a class to enrol the student into.';
  end if;

  select c.academic_year_id
  into v_academic_year_id
  from public.classes as c
  where c.id = v_class_id
    and c.school_id = v_school_id;

  if v_academic_year_id is null then
    raise exception 'The selected class was not found.';
  end if;

  update public.students as s
  set status = 'enrolled'::public.student_status,
      enrollment_date = current_date
  where s.id = v_student_id
    and s.school_id = v_school_id;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status, enrolled_on
  ) values (
    v_school_id, v_student_id, v_class_id, v_academic_year_id,
    'active'::public.enrollment_status,
    current_date
  );

  update public.applications as a
  set status = 'approved'::public.application_status,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where a.id = p_application_id
    and a.school_id = v_school_id;

  return v_student_id;
end;
$$;

comment on function public.approve_application(uuid, uuid) is
  'Approves a submitted application with consent and guardians into a class. Requires can_review_applications().';

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
  v_notes      text := trim(coalesce(p_notes, ''));
begin
  if not public.can_review_applications() then
    raise exception 'You are not authorized to reject applications.';
  end if;

  if v_notes = '' then
    raise exception 'A rejection reason is required.';
  end if;

  select a.student_id, a.status
  into v_student_id, v_status
  from public.applications as a
  where a.id = p_application_id
    and a.school_id = v_school_id
  for update of a;

  if v_student_id is null then
    raise exception 'Application was not found.';
  end if;

  if v_status <> 'submitted'::public.application_status then
    raise exception 'Only submitted applications can be rejected.';
  end if;

  update public.applications as a
  set status = 'rejected'::public.application_status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      decision_notes = v_notes
  where a.id = p_application_id
    and a.school_id = v_school_id;

  update public.students as s
  set status = 'rejected'::public.student_status
  where s.id = v_student_id
    and s.school_id = v_school_id;
end;
$$;

comment on function public.reject_application(uuid, text) is
  'Rejects a submitted application with a mandatory reason. Requires can_review_applications().';
