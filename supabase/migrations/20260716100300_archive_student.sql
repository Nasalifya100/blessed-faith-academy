-- ===========================================================================
-- Sprint 2 (Security): archive students instead of hard delete
--
-- File: 20260716100300_archive_student.sql
-- ===========================================================================

alter table public.students
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

comment on column public.students.archived_at is
  'When the student was archived (withdrawn). Null while active/applicant.';
comment on column public.students.archive_reason is
  'Optional reason recorded by archive_student.';

drop policy if exists "students_delete" on public.students;
revoke delete on table public.students from anon, authenticated;

create or replace function public.archive_student(
  p_student_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_status    public.student_status;
  v_reason    text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to archive students.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select s.status
  into v_status
  from public.students as s
  where s.id = p_student_id
    and s.school_id = v_school_id
  for update of s;

  if v_status is null then
    raise exception 'Student was not found.';
  end if;

  if v_status = 'withdrawn'::public.student_status then
    return;
  end if;

  update public.students as s
  set
    status = 'withdrawn'::public.student_status,
    archived_at = coalesce(s.archived_at, now()),
    archive_reason = coalesce(v_reason, s.archive_reason)
  where s.id = p_student_id
    and s.school_id = v_school_id;

  update public.student_class_enrollments as e
  set status = 'withdrawn'::public.enrollment_status
  where e.student_id = p_student_id
    and e.school_id = v_school_id
    and e.status = 'active'::public.enrollment_status;
end;
$$;

comment on function public.archive_student(uuid, text) is
  'Soft-archives a student as withdrawn. Never deletes. Requires can_manage_students().';

revoke all on function public.archive_student(uuid, text) from public;
revoke all on function public.archive_student(uuid, text) from anon;
grant execute on function public.archive_student(uuid, text) to authenticated;
