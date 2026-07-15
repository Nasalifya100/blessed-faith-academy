-- ===========================================================================
-- Phase 8a: Attendance data model
--
-- Rules (confirmed):
--   * Homeroom teacher may take the register for their class.
--   * Other teachers may be assigned as cover (absent teacher / other cases).
--   * Administrator, headteacher, secretary may take any class register
--     and may grant/revoke cover assignments.
--
-- Statuses: present | absent | late | excused
--
-- Tables:
--   attendance_records          — one mark per student per class per day
--   class_attendance_covers     — temporary cover teachers for a class
-- ===========================================================================

create type public.attendance_status as enum (
  'present',
  'absent',
  'late',
  'excused'
);

-- ---------------------------------------------------------------------------
-- Who may manage cover assignments (office staff)
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_attendance_covers()
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

-- ---------------------------------------------------------------------------
-- 1. class_attendance_covers — substitute / cover teachers
-- ---------------------------------------------------------------------------
create table public.class_attendance_covers (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  class_id     uuid not null references public.classes(id) on delete cascade,
  staff_id     uuid not null references public.profiles(id) on delete cascade,
  valid_from   date not null default current_date,
  valid_until  date,
  is_active    boolean not null default true,
  reason       text not null default '',
  granted_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create index class_attendance_covers_class_idx
  on public.class_attendance_covers (class_id, is_active);

create index class_attendance_covers_staff_idx
  on public.class_attendance_covers (staff_id, is_active);

create trigger class_attendance_covers_set_updated_at
before update on public.class_attendance_covers
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Who may take the register for a given class (today)
-- ---------------------------------------------------------------------------
create or replace function public.can_take_attendance(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Office roles: any class
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and is_active
        and role in ('administrator', 'headteacher', 'secretary')
    )
    -- Homeroom teacher of this class
    or exists (
      select 1 from public.classes c
      where c.id = p_class_id
        and c.school_id = public.current_user_school_id()
        and c.homeroom_teacher_id = auth.uid()
    )
    -- Active cover assignment that includes today
    or exists (
      select 1
      from public.class_attendance_covers cov
      where cov.class_id = p_class_id
        and cov.staff_id = auth.uid()
        and cov.is_active
        and cov.valid_from <= current_date
        and (cov.valid_until is null or cov.valid_until >= current_date)
    );
$$;

-- ---------------------------------------------------------------------------
-- 2. attendance_records — daily marks
-- ---------------------------------------------------------------------------
create table public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  class_id     uuid not null references public.classes(id) on delete restrict,
  student_id   uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  status       public.attendance_status not null default 'present',
  notes        text not null default '',
  recorded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (class_id, student_id, attendance_date)
);

create index attendance_records_class_date_idx
  on public.attendance_records (class_id, attendance_date);

create index attendance_records_student_idx
  on public.attendance_records (student_id, attendance_date);

create trigger attendance_records_set_updated_at
before update on public.attendance_records
for each row execute function public.set_updated_at();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.class_attendance_covers enable row level security;
alter table public.attendance_records      enable row level security;

-- Covers: all school staff may read; office may write
create policy "class_attendance_covers_select"
  on public.class_attendance_covers for select to authenticated
  using (school_id = public.current_user_school_id());

create policy "class_attendance_covers_insert"
  on public.class_attendance_covers for insert to authenticated
  with check (
    public.can_manage_attendance_covers()
    and school_id = public.current_user_school_id()
  );

create policy "class_attendance_covers_update"
  on public.class_attendance_covers for update to authenticated
  using (
    public.can_manage_attendance_covers()
    and school_id = public.current_user_school_id()
  )
  with check (
    public.can_manage_attendance_covers()
    and school_id = public.current_user_school_id()
  );

create policy "class_attendance_covers_delete"
  on public.class_attendance_covers for delete to authenticated
  using (
    public.can_manage_attendance_covers()
    and school_id = public.current_user_school_id()
  );

-- Attendance: school staff may read; write only if can_take_attendance(class)
create policy "attendance_records_select"
  on public.attendance_records for select to authenticated
  using (school_id = public.current_user_school_id());

create policy "attendance_records_insert"
  on public.attendance_records for insert to authenticated
  with check (
    school_id = public.current_user_school_id()
    and public.can_take_attendance(class_id)
  );

create policy "attendance_records_update"
  on public.attendance_records for update to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_take_attendance(class_id)
  )
  with check (
    school_id = public.current_user_school_id()
    and public.can_take_attendance(class_id)
  );

create policy "attendance_records_delete"
  on public.attendance_records for delete to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_take_attendance(class_id)
  );

-- ---------------------------------------------------------------------------
-- assign_attendance_cover — grant a teacher temporary register access
-- ---------------------------------------------------------------------------
create or replace function public.assign_attendance_cover(
  p_class_id    uuid,
  p_staff_id    uuid,
  p_valid_from  date default current_date,
  p_valid_until date default null,
  p_reason      text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_id        uuid;
begin
  if not public.can_manage_attendance_covers() then
    raise exception 'You are not authorized to assign cover teachers.';
  end if;

  if not exists (
    select 1 from public.classes
    where id = p_class_id and school_id = v_school_id and is_active
  ) then
    raise exception 'Class was not found.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_staff_id
      and school_id = v_school_id
      and is_active
      and role = 'teacher'
  ) then
    raise exception 'Cover must be an active teacher at this school.';
  end if;

  if p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'Cover end date cannot be before the start date.';
  end if;

  insert into public.class_attendance_covers (
    school_id, class_id, staff_id,
    valid_from, valid_until, reason, granted_by
  ) values (
    v_school_id, p_class_id, p_staff_id,
    p_valid_from, p_valid_until, coalesce(p_reason, ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- revoke_attendance_cover — deactivate a cover assignment
-- ---------------------------------------------------------------------------
create or replace function public.revoke_attendance_cover(
  p_cover_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.can_manage_attendance_covers() then
    raise exception 'You are not authorized to revoke cover teachers.';
  end if;

  update public.class_attendance_covers
  set is_active = false,
      valid_until = least(coalesce(valid_until, current_date), current_date)
  where id = p_cover_id
    and school_id = public.current_user_school_id()
    and is_active;

  if not found then
    raise exception 'Cover assignment was not found or is already inactive.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_class_attendance — upsert marks for a class on one day
--
-- p_marks: jsonb array of { "student_id": "...", "status": "present", "notes": "" }
-- Returns number of rows written.
-- ---------------------------------------------------------------------------
create or replace function public.save_class_attendance(
  p_class_id         uuid,
  p_attendance_date  date,
  p_marks            jsonb
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_year_id   uuid;
  v_mark      jsonb;
  v_student   uuid;
  v_status    public.attendance_status;
  v_notes     text;
  v_count     int := 0;
begin
  if not public.can_take_attendance(p_class_id) then
    raise exception 'You are not authorized to take attendance for this class.';
  end if;

  if p_attendance_date is null then
    raise exception 'Attendance date is required.';
  end if;

  if jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    raise exception 'Provide at least one attendance mark.';
  end if;

  select academic_year_id into v_year_id
  from public.classes
  where id = p_class_id and school_id = v_school_id and is_active;

  if v_year_id is null then
    raise exception 'Class was not found.';
  end if;

  for v_mark in select * from jsonb_array_elements(p_marks)
  loop
    v_student := (v_mark->>'student_id')::uuid;
    v_status  := (v_mark->>'status')::public.attendance_status;
    v_notes   := coalesce(v_mark->>'notes', '');

    if v_student is null or v_status is null then
      raise exception 'Each mark needs student_id and status.';
    end if;

    -- Student must be actively enrolled in this class for the class year
    if not exists (
      select 1
      from public.student_class_enrollments e
      where e.student_id = v_student
        and e.class_id = p_class_id
        and e.academic_year_id = v_year_id
        and e.status = 'active'
    ) then
      raise exception 'Student is not actively enrolled in this class.';
    end if;

    insert into public.attendance_records (
      school_id, class_id, student_id, attendance_date,
      status, notes, recorded_by
    ) values (
      v_school_id, p_class_id, v_student, p_attendance_date,
      v_status, v_notes, auth.uid()
    )
    on conflict (class_id, student_id, attendance_date)
    do update set
      status = excluded.status,
      notes = excluded.notes,
      recorded_by = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
