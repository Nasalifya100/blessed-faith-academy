-- ===========================================================================
-- Phase 2A.3 — Teaching assignments
-- ===========================================================================

do $$ begin
  create type public.teaching_assignment_role as enum (
    'SUBJECT_TEACHER',
    'ASSISTANT_TEACHER',
    'HEAD_OF_DEPARTMENT',
    'SUBSTITUTE_TEACHER'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.teaching_assignments (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete restrict,
  subject_offering_id  uuid not null references public.subject_offerings(id) on delete restrict,
  staff_id             uuid not null references public.profiles(id) on delete restrict,
  class_id             uuid references public.classes(id) on delete restrict,
  role_type            public.teaching_assignment_role not null default 'SUBJECT_TEACHER',
  is_primary           boolean not null default true,
  is_active            boolean not null default true,
  effective_from       date,
  effective_to         date,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint teaching_assignments_dates_check
    check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create trigger teaching_assignments_set_updated_at
before update on public.teaching_assignments
for each row execute function public.set_updated_at();

-- One active primary subject-teacher per offering (+ optional class scope)
create unique index if not exists teaching_assignments_active_primary_uidx
  on public.teaching_assignments (
    subject_offering_id,
    coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    role_type
  )
  where is_active and is_primary;

create index if not exists teaching_assignments_staff_idx
  on public.teaching_assignments (staff_id, is_active);

alter table public.teaching_assignments enable row level security;

drop policy if exists "teaching_assignments_select" on public.teaching_assignments;
create policy "teaching_assignments_select"
  on public.teaching_assignments
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW')
      or staff_id = auth.uid()
    )
  );

revoke insert, update, delete on table public.teaching_assignments
  from anon, authenticated;
grant select on table public.teaching_assignments to authenticated;

create or replace function public.assign_subject_teacher(
  p_subject_offering_id uuid,
  p_staff_id uuid,
  p_class_id uuid default null,
  p_role_type public.teaching_assignment_role default 'SUBJECT_TEACHER',
  p_is_primary boolean default true,
  p_effective_from date default null,
  p_effective_to date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_offering public.subject_offerings%rowtype;
  v_id uuid;
begin
  perform public.require_academic_capability('TEACHING_ASSIGNMENTS_MANAGE');

  -- Teachers cannot assign themselves via this RPC even if capability were granted.
  if p_staff_id = auth.uid() and not public.is_administrator()
     and public.current_user_role() <> 'headteacher'::public.staff_role then
    raise exception 'You cannot assign yourself as a subject teacher.';
  end if;

  select * into v_offering
  from public.subject_offerings
  where id = p_subject_offering_id and school_id = v_school and is_active;

  if not found then
    raise exception 'Subject offering not found or inactive.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_staff_id
      and school_id = v_school
      and is_active
  ) then
    raise exception 'Staff member not found or inactive.';
  end if;

  if p_class_id is not null then
    if not exists (
      select 1 from public.classes c
      where c.id = p_class_id
        and c.school_id = v_school
        and c.grade_level_id = v_offering.grade_level_id
        and c.academic_year_id = v_offering.academic_year_id
    ) then
      raise exception 'Class is outside the subject offering scope.';
    end if;
  elsif v_offering.class_id is not null then
    p_class_id := v_offering.class_id;
  end if;

  -- End previous active primary of same role/scope
  if coalesce(p_is_primary, true) then
    update public.teaching_assignments
    set is_active = false,
        effective_to = coalesce(p_effective_from, current_date),
        updated_at = now()
    where subject_offering_id = p_subject_offering_id
      and coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(p_class_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and role_type = coalesce(p_role_type, 'SUBJECT_TEACHER')
      and is_primary
      and is_active;
  end if;

  insert into public.teaching_assignments (
    school_id, subject_offering_id, staff_id, class_id, role_type,
    is_primary, is_active, effective_from, effective_to, created_by
  ) values (
    v_school, p_subject_offering_id, p_staff_id, p_class_id,
    coalesce(p_role_type, 'SUBJECT_TEACHER'),
    coalesce(p_is_primary, true), true,
    p_effective_from, p_effective_to, auth.uid()
  )
  returning id into v_id;

  perform public.log_academic_event(
    'TEACHING_ASSIGNMENT_CREATED', 'teaching_assignment', v_id,
    jsonb_build_object(
      'subject_offering_id', p_subject_offering_id,
      'staff_id', p_staff_id,
      'class_id', p_class_id,
      'role_type', coalesce(p_role_type, 'SUBJECT_TEACHER')
    )
  );
  return v_id;
exception
  when unique_violation then
    raise exception 'That teaching assignment already exists.';
end;
$$;

revoke all on function public.assign_subject_teacher(uuid, uuid, uuid, public.teaching_assignment_role, boolean, date, date) from public;
grant execute on function public.assign_subject_teacher(uuid, uuid, uuid, public.teaching_assignment_role, boolean, date, date) to authenticated;

create or replace function public.end_teaching_assignment(
  p_assignment_id uuid,
  p_effective_to date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
begin
  perform public.require_academic_capability('TEACHING_ASSIGNMENTS_MANAGE');
  update public.teaching_assignments
  set
    is_active = false,
    effective_to = coalesce(p_effective_to, current_date),
    updated_at = now()
  where id = p_assignment_id and school_id = v_school and is_active;
  if not found then
    raise exception 'Assignment not found or already ended.';
  end if;
  perform public.log_academic_event(
    'TEACHING_ASSIGNMENT_ENDED', 'teaching_assignment', p_assignment_id,
    jsonb_build_object('effective_to', coalesce(p_effective_to, current_date))
  );
end;
$$;

revoke all on function public.end_teaching_assignment(uuid, date) from public;
grant execute on function public.end_teaching_assignment(uuid, date) to authenticated;
