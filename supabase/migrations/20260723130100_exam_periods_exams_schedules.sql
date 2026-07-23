-- ===========================================================================
-- Phase 2B.1 — Exam periods, templates, exams, timetable, eligibility
-- Configuration and scheduling only. NO marks / scores / results tables.
-- UI wording: Exam Period, Exam, Exam Schedule, Students Taking This Exam.
-- ===========================================================================

do $$ begin
  create type public.exam_period_status as enum (
    'DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.exam_invigilator_role as enum (
    'PRIMARY', 'ASSISTANT'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.exam_exclusion_reason as enum (
    'MEDICAL', 'TRANSFERRED', 'ABSENT', 'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.exam_cohort_scope as enum (
    'GRADE', 'CLASS'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Exam periods (UI: Exam Period)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_periods (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  term_id           uuid references public.terms(id) on delete restrict,
  name              text not null,
  description       text,
  opens_on          date,
  closes_on         date,
  status            public.exam_period_status not null default 'DRAFT',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null,
  constraint exam_periods_name_nonempty check (btrim(name) <> ''),
  constraint exam_periods_date_order check (
    opens_on is null or closes_on is null or closes_on >= opens_on
  )
);

create unique index if not exists exam_periods_school_year_name_uidx
  on public.exam_periods (school_id, academic_year_id, lower(btrim(name)));

create index if not exists exam_periods_school_status_idx
  on public.exam_periods (school_id, status);

comment on table public.exam_periods is
  'Named exam sitting windows (Mid-Term, End of Term, Mock…). No marks.';

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table if not exists public.exam_templates (
  id                     uuid primary key default gen_random_uuid(),
  school_id              uuid not null references public.schools(id) on delete restrict,
  name                   text not null,
  description            text,
  source_exam_period_id  uuid references public.exam_periods(id) on delete set null,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint exam_templates_name_nonempty check (btrim(name) <> '')
);

create unique index if not exists exam_templates_school_name_uidx
  on public.exam_templates (school_id, lower(btrim(name)));

create table if not exists public.exam_template_items (
  id                     uuid primary key default gen_random_uuid(),
  school_id              uuid not null references public.schools(id) on delete restrict,
  exam_template_id       uuid not null references public.exam_templates(id) on delete cascade,
  subject_id             uuid not null references public.subjects(id) on delete restrict,
  grade_level_id         uuid not null references public.grade_levels(id) on delete restrict,
  assessment_type_id     uuid not null references public.assessment_types(id) on delete restrict,
  max_marks              numeric(8,2) not null check (max_marks > 0),
  default_duration_minutes integer check (default_duration_minutes is null or default_duration_minutes > 0),
  default_room_id        uuid references public.exam_rooms(id) on delete set null,
  instructions           text,
  display_order          integer not null default 0,
  unique (exam_template_id, subject_id, grade_level_id, assessment_type_id)
);

-- ---------------------------------------------------------------------------
-- Exams (UI: Exam) — still NO scores
-- ---------------------------------------------------------------------------
create table if not exists public.exams (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete restrict,
  exam_period_id      uuid not null references public.exam_periods(id) on delete restrict,
  subject_id          uuid not null references public.subjects(id) on delete restrict,
  grade_level_id      uuid not null references public.grade_levels(id) on delete restrict,
  class_id            uuid references public.classes(id) on delete restrict,
  assessment_type_id  uuid not null references public.assessment_types(id) on delete restrict,
  title               text,
  max_marks           numeric(8,2) not null check (max_marks > 0),
  instructions        text,
  notes               text,
  cohort_scope        public.exam_cohort_scope not null default 'GRADE',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exams_title_optional_nonempty check (title is null or btrim(title) <> ''),
  constraint exams_class_scope_consistent check (
    (cohort_scope = 'GRADE' and class_id is null)
    or (cohort_scope = 'CLASS' and class_id is not null)
  )
);

-- Prevent duplicate exams in the same period for same subject/grade/type/class.
create unique index if not exists exams_period_subject_grade_type_class_uidx
  on public.exams (
    exam_period_id,
    subject_id,
    grade_level_id,
    assessment_type_id,
    coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active;

create index if not exists exams_period_idx on public.exams (exam_period_id);
create index if not exists exams_grade_idx on public.exams (grade_level_id);

comment on table public.exams is
  'Scheduled exam definitions (subject × grade × type). Scores live in a later phase.';

-- ---------------------------------------------------------------------------
-- Timetable (UI: Exam Schedule)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_schedules (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete restrict,
  exam_id         uuid not null references public.exams(id) on delete cascade,
  exam_date       date not null,
  start_time      time not null,
  end_time        time not null,
  room_id         uuid references public.exam_rooms(id) on delete set null,
  capacity_override integer check (capacity_override is null or capacity_override > 0),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint exam_schedules_time_order check (end_time > start_time),
  unique (exam_id)
);

create index if not exists exam_schedules_date_idx
  on public.exam_schedules (school_id, exam_date, start_time);

create index if not exists exam_schedules_room_idx
  on public.exam_schedules (room_id, exam_date)
  where room_id is not null;

-- ---------------------------------------------------------------------------
-- Invigilators
-- ---------------------------------------------------------------------------
create table if not exists public.exam_invigilators (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete restrict,
  exam_schedule_id  uuid not null references public.exam_schedules(id) on delete cascade,
  staff_id          uuid not null references public.profiles(id) on delete restrict,
  role              public.exam_invigilator_role not null default 'PRIMARY',
  created_at        timestamptz not null default now(),
  unique (exam_schedule_id, staff_id)
);

create unique index if not exists exam_invigilators_one_primary_uidx
  on public.exam_invigilators (exam_schedule_id)
  where role = 'PRIMARY';

create index if not exists exam_invigilators_staff_idx
  on public.exam_invigilators (staff_id);

-- ---------------------------------------------------------------------------
-- Students taking this exam — exclusions only (default = whole grade/class)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_exclusions (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  exam_id      uuid not null references public.exams(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete restrict,
  reason       public.exam_exclusion_reason not null default 'OTHER',
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,
  unique (exam_id, student_id)
);

-- ---------------------------------------------------------------------------
-- RLS (select only; writes via RPCs)
-- ---------------------------------------------------------------------------
alter table public.exam_periods enable row level security;
alter table public.exam_templates enable row level security;
alter table public.exam_template_items enable row level security;
alter table public.exams enable row level security;
alter table public.exam_schedules enable row level security;
alter table public.exam_invigilators enable row level security;
alter table public.exam_exclusions enable row level security;

drop policy if exists "exam_periods_select" on public.exam_periods;
create policy "exam_periods_select" on public.exam_periods
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('EXAM_VIEW')
  );

drop policy if exists "exam_templates_select" on public.exam_templates;
create policy "exam_templates_select" on public.exam_templates
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('EXAM_VIEW')
  );

drop policy if exists "exam_template_items_select" on public.exam_template_items;
create policy "exam_template_items_select" on public.exam_template_items
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('EXAM_VIEW')
  );

drop policy if exists "exams_select" on public.exams;
create policy "exams_select" on public.exams
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('EXAM_VIEW')
      or exists (
        select 1 from public.exam_schedules s
        join public.exam_invigilators i on i.exam_schedule_id = s.id
        where s.exam_id = exams.id and i.staff_id = auth.uid()
      )
    )
  );

drop policy if exists "exam_schedules_select" on public.exam_schedules;
create policy "exam_schedules_select" on public.exam_schedules
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('EXAM_VIEW')
      or exists (
        select 1 from public.exam_invigilators i
        where i.exam_schedule_id = exam_schedules.id and i.staff_id = auth.uid()
      )
    )
  );

drop policy if exists "exam_invigilators_select" on public.exam_invigilators;
create policy "exam_invigilators_select" on public.exam_invigilators
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('EXAM_VIEW')
      or staff_id = auth.uid()
    )
  );

drop policy if exists "exam_exclusions_select" on public.exam_exclusions;
create policy "exam_exclusions_select" on public.exam_exclusions
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('EXAMS_MANAGE')
  );

revoke insert, update, delete on table public.exam_periods from anon, authenticated;
revoke insert, update, delete on table public.exam_templates from anon, authenticated;
revoke insert, update, delete on table public.exam_template_items from anon, authenticated;
revoke insert, update, delete on table public.exams from anon, authenticated;
revoke insert, update, delete on table public.exam_schedules from anon, authenticated;
revoke insert, update, delete on table public.exam_invigilators from anon, authenticated;
revoke insert, update, delete on table public.exam_exclusions from anon, authenticated;

grant select on table public.exam_periods to authenticated;
grant select on table public.exam_templates to authenticated;
grant select on table public.exam_template_items to authenticated;
grant select on table public.exams to authenticated;
grant select on table public.exam_schedules to authenticated;
grant select on table public.exam_invigilators to authenticated;
grant select on table public.exam_exclusions to authenticated;

-- ---------------------------------------------------------------------------
-- Conflict detection (warnings with how-to-fix text)
-- ---------------------------------------------------------------------------
create or replace function public.detect_exam_schedule_conflicts(
  p_exam_id uuid,
  p_exam_date date,
  p_start_time time,
  p_end_time time,
  p_room_id uuid default null,
  p_primary_invigilator_id uuid default null,
  p_schedule_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_exam public.exams%rowtype;
  v_period public.exam_periods%rowtype;
  v_warnings jsonb := '[]'::jsonb;
  v_room public.exam_rooms%rowtype;
  v_staff public.profiles%rowtype;
  r record;
begin
  if not public.has_academic_capability('EXAM_VIEW') then
    raise exception 'Not authorized.';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and school_id = v_school;
  if not found then
    return jsonb_build_array(jsonb_build_object(
      'code', 'EXAM_MISSING',
      'message', 'Exam not found.',
      'fix', 'Choose an existing exam in this period.'
    ));
  end if;

  select * into v_period from public.exam_periods where id = v_exam.exam_period_id;

  if p_end_time <= p_start_time then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'END_BEFORE_START',
      'message', 'End time is not after start time.',
      'fix', 'Set an end time later than the start time.'
    ));
  end if;

  if v_period.opens_on is not null and p_exam_date < v_period.opens_on then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'OUTSIDE_PERIOD_OPEN',
      'message', 'Exam date is before the exam period opening date.',
      'fix', format('Use a date on or after %s, or widen the exam period dates.', v_period.opens_on)
    ));
  end if;

  if v_period.closes_on is not null and p_exam_date > v_period.closes_on then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'OUTSIDE_PERIOD_CLOSE',
      'message', 'Exam date is after the exam period closing date.',
      'fix', format('Use a date on or before %s, or widen the exam period dates.', v_period.closes_on)
    ));
  end if;

  if exists (select 1 from public.subjects s where s.id = v_exam.subject_id and not s.is_active) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'INACTIVE_SUBJECT',
      'message', 'This subject is inactive.',
      'fix', 'Reactivate the subject in Academic setup, or choose another subject.'
    ));
  end if;

  if p_room_id is not null then
    select * into v_room from public.exam_rooms where id = p_room_id and school_id = v_school;
    if not found then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'ROOM_MISSING',
        'message', 'Room not found.',
        'fix', 'Pick a room from the school room list.'
      ));
    elsif not v_room.is_active then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'INACTIVE_ROOM',
        'message', format('Room "%s" is inactive.', v_room.name),
        'fix', 'Reactivate the room or choose another room.'
      ));
    else
      for r in
        select sub.name as subject_name, gl.name as grade_name
        from public.exam_schedules s
        join public.exams e on e.id = s.exam_id
        join public.subjects sub on sub.id = e.subject_id
        join public.grade_levels gl on gl.id = e.grade_level_id
        where s.school_id = v_school
          and s.room_id = p_room_id
          and s.exam_date = p_exam_date
          and (p_schedule_id is null or s.id <> p_schedule_id)
          and s.start_time < p_end_time
          and s.end_time > p_start_time
      loop
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'ROOM_DOUBLE_BOOKED',
          'message', format('Room is already used for %s %s at overlapping time.', r.grade_name, r.subject_name),
          'fix', 'Choose a different room or change the date/time so they do not overlap.'
        ));
      end loop;
    end if;
  end if;

  if p_primary_invigilator_id is not null then
    select * into v_staff from public.profiles where id = p_primary_invigilator_id and school_id = v_school;
    if not found then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'STAFF_MISSING',
        'message', 'Invigilator not found.',
        'fix', 'Choose an active teacher from the list.'
      ));
    elsif not v_staff.is_active then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'INACTIVE_TEACHER',
        'message', format('%s is inactive and cannot be assigned.', v_staff.full_name),
        'fix', 'Reactivate the staff account or choose another invigilator.'
      ));
    else
      for r in
        select sub.name as subject_name, gl.name as grade_name
        from public.exam_invigilators i
        join public.exam_schedules s on s.id = i.exam_schedule_id
        join public.exams e on e.id = s.exam_id
        join public.subjects sub on sub.id = e.subject_id
        join public.grade_levels gl on gl.id = e.grade_level_id
        where i.staff_id = p_primary_invigilator_id
          and s.exam_date = p_exam_date
          and (p_schedule_id is null or s.id <> p_schedule_id)
          and s.start_time < p_end_time
          and s.end_time > p_start_time
      loop
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'TEACHER_DOUBLE_BOOKED',
          'message', format('%s is already supervising %s %s at an overlapping time.', v_staff.full_name, r.grade_name, r.subject_name),
          'fix', 'Assign a different invigilator or change the overlapping exam time.'
        ));
      end loop;
    end if;
  end if;

  for r in
    select sub.name as subject_name
    from public.exam_schedules s
    join public.exams e on e.id = s.exam_id
    join public.subjects sub on sub.id = e.subject_id
    where e.school_id = v_school
      and e.grade_level_id = v_exam.grade_level_id
      and e.id <> p_exam_id
      and e.is_active
      and s.exam_date = p_exam_date
      and (p_schedule_id is null or s.id <> p_schedule_id)
      and s.start_time < p_end_time
      and s.end_time > p_start_time
      and (
        v_exam.class_id is null
        or e.class_id is null
        or e.class_id = v_exam.class_id
      )
  loop
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'GRADE_DOUBLE_BOOKED',
      'message', format('This grade already has %s at an overlapping time.', r.subject_name),
      'fix', 'Move one exam to another time slot so students are not double-booked.'
    ));
  end loop;

  return v_warnings;
end;
$$;

revoke all on function public.detect_exam_schedule_conflicts(uuid, date, time, time, uuid, uuid, uuid) from public;
grant execute on function public.detect_exam_schedule_conflicts(uuid, date, time, time, uuid, uuid, uuid) to authenticated;
