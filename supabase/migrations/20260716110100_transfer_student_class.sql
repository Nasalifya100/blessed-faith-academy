-- ===========================================================================
-- Sprint 3: Mid-year class transfer with enrolment history (H7)
--
-- File: 20260716110100_transfer_student_class.sql
--
-- Allows multiple enrolment rows per student per academic year, with at most
-- one active placement. transfer_student_class closes the current row and
-- opens a new active row in the target class.
-- ===========================================================================

alter table public.student_class_enrollments
  drop constraint if exists student_class_enrollments_student_id_academic_year_id_key;

create unique index if not exists student_class_enrollments_one_active_per_year
  on public.student_class_enrollments (student_id, academic_year_id)
  where status = 'active'::public.enrollment_status;

comment on index public.student_class_enrollments_one_active_per_year is
  'At most one active class placement per student per academic year. Historical rows (transferred/completed/withdrawn) are allowed.';

create or replace function public.transfer_student_class(
  p_student_id uuid,
  p_new_class_id uuid,
  p_transferred_on date default ((now() at time zone 'Africa/Lusaka')::date)
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_student_status   public.student_status;
  v_old_id           uuid;
  v_old_class_id     uuid;
  v_academic_year_id uuid;
  v_new_year_id      uuid;
  v_new_school_id    uuid;
  v_new_id           uuid;
  v_on               date := coalesce(
    p_transferred_on,
    (now() at time zone 'Africa/Lusaka')::date
  );
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to transfer students.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select s.status
  into v_student_status
  from public.students as s
  where s.id = p_student_id
    and s.school_id = v_school_id
  for update of s;

  if v_student_status is null then
    raise exception 'Student was not found.';
  end if;

  if v_student_status <> 'enrolled'::public.student_status then
    raise exception 'Only enrolled students can be transferred between classes.';
  end if;

  select e.id, e.class_id, e.academic_year_id
  into v_old_id, v_old_class_id, v_academic_year_id
  from public.student_class_enrollments as e
  where e.student_id = p_student_id
    and e.school_id = v_school_id
    and e.status = 'active'::public.enrollment_status
  for update of e;

  if v_old_id is null then
    raise exception 'Student has no active class enrolment to transfer from.';
  end if;

  if v_old_class_id = p_new_class_id then
    raise exception 'Student is already in that class.';
  end if;

  select c.school_id, c.academic_year_id
  into v_new_school_id, v_new_year_id
  from public.classes as c
  where c.id = p_new_class_id
    and c.is_active
  for share of c;

  if v_new_school_id is null then
    raise exception 'Target class was not found or is inactive.';
  end if;

  if v_new_school_id <> v_school_id then
    raise exception 'Target class belongs to a different school.';
  end if;

  if v_new_year_id <> v_academic_year_id then
    raise exception 'Target class must be in the same academic year as the current enrolment.';
  end if;

  update public.student_class_enrollments as e
  set status = 'transferred'::public.enrollment_status
  where e.id = v_old_id
    and e.school_id = v_school_id
    and e.status = 'active'::public.enrollment_status;

  if not found then
    raise exception 'Could not close the current class enrolment.';
  end if;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status, enrolled_on
  )
  values (
    v_school_id,
    p_student_id,
    p_new_class_id,
    v_academic_year_id,
    'active'::public.enrollment_status,
    v_on
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.transfer_student_class(uuid, uuid, date) is
  'Closes the active class enrolment as transferred and opens a new active enrolment in the same academic year. Requires can_manage_students().';

revoke all on function public.transfer_student_class(uuid, uuid, date) from public;
revoke all on function public.transfer_student_class(uuid, uuid, date) from anon;
grant execute on function public.transfer_student_class(uuid, uuid, date) to authenticated;
