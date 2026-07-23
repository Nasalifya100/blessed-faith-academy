-- ===========================================================================
-- Phase 2B.0 — Exam rooms + examination capabilities
-- Extends has_academic_capability for exam setup (no marks entry).
-- ===========================================================================

create table if not exists public.exam_rooms (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  name         text not null,
  capacity     integer check (capacity is null or capacity > 0),
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint exam_rooms_name_nonempty check (btrim(name) <> '')
);

create unique index if not exists exam_rooms_school_name_uidx
  on public.exam_rooms (school_id, lower(btrim(name)));

create index if not exists exam_rooms_school_active_idx
  on public.exam_rooms (school_id, is_active);

comment on table public.exam_rooms is
  'Lightweight exam venue catalogue. No marks storage.';

alter table public.exam_rooms enable row level security;

drop policy if exists "exam_rooms_select" on public.exam_rooms;
create policy "exam_rooms_select"
  on public.exam_rooms
  for select
  to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('EXAM_VIEW')
  );

revoke insert, update, delete on table public.exam_rooms from anon, authenticated;
grant select on table public.exam_rooms to authenticated;

-- Capability defaults for examination setup (still no MARKS_ENTER).
create or replace function public.has_academic_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.staff_role;
  v_cap text := upper(btrim(coalesce(p_capability, '')));
begin
  if auth.uid() is null then
    return false;
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active;

  if not found then
    return false;
  end if;

  if v_role = 'administrator'::public.staff_role then
    return true;
  end if;

  if v_role = 'headteacher'::public.staff_role then
    if v_cap in (
      'ACADEMIC_CONFIGURATION_VIEW',
      'SUBJECTS_MANAGE',
      'SUBJECT_OFFERINGS_MANAGE',
      'TEACHING_ASSIGNMENTS_MANAGE',
      'GRADING_SCHEMES_MANAGE',
      'ASSESSMENT_TYPES_MANAGE',
      'ASSESSMENT_WEIGHTS_MANAGE',
      'ACADEMIC_CALENDAR_MANAGE',
      'ACADEMIC_SETTINGS_MANAGE',
      'EXAM_VIEW',
      'EXAM_ROOMS_MANAGE',
      'EXAM_PERIODS_MANAGE',
      'EXAMS_MANAGE',
      'EXAM_SCHEDULE_MANAGE',
      'EXAM_TEMPLATES_MANAGE'
    ) then
      return true;
    end if;
  end if;

  -- Teachers / office: view upcoming exams and academic config; no setup writes.
  if v_cap in ('ACADEMIC_CONFIGURATION_VIEW', 'EXAM_VIEW') then
    return v_role in (
      'teacher'::public.staff_role,
      'secretary'::public.staff_role,
      'bursar'::public.staff_role,
      'headteacher'::public.staff_role
    );
  end if;

  return exists (
    select 1
    from public.academic_capabilities c
    where c.profile_id = auth.uid()
      and c.capability = v_cap
      and c.is_active
      and c.school_id = public.current_user_school_id()
  );
end;
$$;

revoke all on function public.has_academic_capability(text) from public;
grant execute on function public.has_academic_capability(text) to authenticated;

create or replace function public.upsert_exam_room(
  p_id uuid default null,
  p_name text default null,
  p_capacity integer default null,
  p_notes text default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform public.require_academic_capability('EXAM_ROOMS_MANAGE');
  if v_school is null then
    raise exception 'No school context.';
  end if;
  if v_name is null then
    raise exception 'Room name is required.';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise exception 'Room capacity must be greater than zero.';
  end if;

  if p_id is null then
    insert into public.exam_rooms (school_id, name, capacity, notes, is_active)
    values (v_school, v_name, p_capacity, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_is_active, true))
    returning id into v_id;
    perform public.log_academic_event(
      'ROOM_ASSIGNED',
      'exam_room',
      v_id,
      jsonb_build_object('name', v_name, 'action', 'created')
    );
  else
    update public.exam_rooms
    set
      name = v_name,
      capacity = p_capacity,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where id = p_id and school_id = v_school
    returning id into v_id;
    if v_id is null then
      raise exception 'Room not found.';
    end if;
    perform public.log_academic_event(
      'ROOM_ASSIGNED',
      'exam_room',
      v_id,
      jsonb_build_object('name', v_name, 'action', 'updated', 'is_active', coalesce(p_is_active, true))
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_exam_room(uuid, text, integer, text, boolean) from public;
grant execute on function public.upsert_exam_room(uuid, text, integer, text, boolean) to authenticated;

-- Staff candidates for invigilation (works for headteachers; no Auth emails).
create or replace function public.list_exam_staff_candidates()
returns table (
  id uuid,
  full_name text,
  role public.staff_role,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
begin
  if not (
    public.has_academic_capability('EXAM_SCHEDULE_MANAGE')
    or public.has_academic_capability('EXAMS_MANAGE')
    or public.has_academic_capability('EXAM_VIEW')
  ) then
    raise exception 'You are not authorized to list exam staff.';
  end if;

  return query
  select p.id, p.full_name, p.role, p.is_active
  from public.profiles p
  where p.school_id = v_school
    and p.role in (
      'teacher'::public.staff_role,
      'headteacher'::public.staff_role,
      'administrator'::public.staff_role
    )
  order by p.full_name;
end;
$$;

revoke all on function public.list_exam_staff_candidates() from public;
grant execute on function public.list_exam_staff_candidates() to authenticated;
