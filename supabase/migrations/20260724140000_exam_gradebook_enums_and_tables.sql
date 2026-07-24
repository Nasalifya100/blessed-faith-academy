-- ===========================================================================
-- Phase 2C Stage 1 — Exam gradebook enums, tables, helpers, RLS
-- Additive only. Marks entry against Phase 2B exams. No UI.
-- Gradebook scope: one exam + one class. Writes via later SECURITY DEFINER RPCs.
-- ===========================================================================

do $$ begin
  create type public.gradebook_status as enum (
    'DRAFT',
    'SUBMITTED',
    'REOPENED',
    'LOCKED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.result_entry_status as enum (
    'SCORED',
    'ABSENT',
    'EXEMPT',
    'NOT_ASSESSED'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- exam_gradebooks — teacher mark-entry session per (exam, class)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_gradebooks (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete restrict,
  exam_id            uuid not null references public.exams(id) on delete restrict,
  class_id           uuid not null references public.classes(id) on delete restrict,
  status             public.gradebook_status not null default 'DRAFT',
  revision           integer not null default 1 check (revision >= 1),
  opened_by          uuid references public.profiles(id) on delete set null,
  opened_at          timestamptz not null default now(),
  last_saved_by      uuid references public.profiles(id) on delete set null,
  last_saved_at      timestamptz,
  submitted_by       uuid references public.profiles(id) on delete set null,
  submitted_at       timestamptz,
  reopened_by        uuid references public.profiles(id) on delete set null,
  reopened_at        timestamptz,
  reopening_reason   text,
  locked_by          uuid references public.profiles(id) on delete set null,
  locked_at          timestamptz,
  -- Eligible student ids at last successful submit (roster drift safety).
  roster_snapshot    jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint exam_gradebooks_reopen_reason_chk check (
    status <> 'REOPENED'::public.gradebook_status
    or (reopening_reason is not null and btrim(reopening_reason) <> '')
  ),
  constraint exam_gradebooks_submitted_meta_chk check (
    status not in (
      'SUBMITTED'::public.gradebook_status,
      'LOCKED'::public.gradebook_status
    )
    or (submitted_at is not null and submitted_by is not null)
  ),
  constraint exam_gradebooks_locked_meta_chk check (
    status <> 'LOCKED'::public.gradebook_status
    or (locked_at is not null and locked_by is not null)
  ),
  unique (exam_id, class_id)
);

create trigger exam_gradebooks_set_updated_at
before update on public.exam_gradebooks
for each row execute function public.set_updated_at();

create index if not exists exam_gradebooks_school_status_idx
  on public.exam_gradebooks (school_id, status);

create index if not exists exam_gradebooks_class_idx
  on public.exam_gradebooks (class_id);

create index if not exists exam_gradebooks_exam_idx
  on public.exam_gradebooks (exam_id);

create index if not exists exam_gradebooks_opened_by_idx
  on public.exam_gradebooks (opened_by)
  where opened_by is not null;

comment on table public.exam_gradebooks is
  'Phase 2C mark-entry session for one exam and one class. Mutations via RPCs only.';

-- ---------------------------------------------------------------------------
-- exam_assessment_results — per-student marks / statuses
-- ---------------------------------------------------------------------------
create table if not exists public.exam_assessment_results (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete restrict,
  gradebook_id        uuid not null references public.exam_gradebooks(id) on delete cascade,
  exam_id             uuid not null references public.exams(id) on delete restrict,
  student_id          uuid not null references public.students(id) on delete restrict,
  entry_status        public.result_entry_status not null,
  marks_obtained      numeric(8,2),
  max_marks_snapshot  numeric(8,2) not null check (max_marks_snapshot > 0),
  comment             text,
  row_revision        integer not null default 1 check (row_revision >= 1),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exam_assessment_results_scored_chk check (
    (
      entry_status = 'SCORED'::public.result_entry_status
      and marks_obtained is not null
      and marks_obtained >= 0
      and marks_obtained <= max_marks_snapshot
    )
    or (
      entry_status <> 'SCORED'::public.result_entry_status
      and marks_obtained is null
    )
  ),
  -- One result per student within a gradebook. Do NOT unique (exam_id, student_id):
  -- transfers/draft cleanup can require rows in different class gradebooks before submit.
  -- Submit RPC enforces at most one SUBMITTED/LOCKED result per exam+student.
  unique (gradebook_id, student_id)
);

create trigger exam_assessment_results_set_updated_at
before update on public.exam_assessment_results
for each row execute function public.set_updated_at();

create index if not exists exam_assessment_results_gradebook_idx
  on public.exam_assessment_results (gradebook_id);

create index if not exists exam_assessment_results_student_idx
  on public.exam_assessment_results (student_id, exam_id);

create index if not exists exam_assessment_results_exam_idx
  on public.exam_assessment_results (exam_id);

comment on table public.exam_assessment_results is
  'Phase 2C student marks/statuses for an exam gradebook. Mutations via RPCs only.';

-- ---------------------------------------------------------------------------
-- Helpers (security definer; used by RLS + RPCs)
-- ---------------------------------------------------------------------------

create or replace function public.teacher_assigned_to_exam_class(
  p_exam_id uuid,
  p_class_id uuid,
  p_staff_id uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_exam public.exams%rowtype;
  v_period public.exam_periods%rowtype;
  v_class public.classes%rowtype;
begin
  if p_exam_id is null or p_class_id is null or p_staff_id is null then
    return false;
  end if;

  select * into v_exam
  from public.exams
  where id = p_exam_id and school_id = v_school and is_active;

  if not found then
    return false;
  end if;

  select * into v_period
  from public.exam_periods
  where id = v_exam.exam_period_id and school_id = v_school;

  if not found then
    return false;
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id and school_id = v_school;

  if not found then
    return false;
  end if;

  if v_class.grade_level_id <> v_exam.grade_level_id
     or v_class.academic_year_id <> v_period.academic_year_id then
    return false;
  end if;

  if v_exam.cohort_scope = 'CLASS'::public.exam_cohort_scope
     and v_exam.class_id is distinct from p_class_id then
    return false;
  end if;

  return exists (
    select 1
    from public.teaching_assignments ta
    join public.subject_offerings so on so.id = ta.subject_offering_id
    where ta.school_id = v_school
      and ta.staff_id = p_staff_id
      and ta.is_active
      and so.is_active
      and so.school_id = v_school
      and so.subject_id = v_exam.subject_id
      and so.grade_level_id = v_exam.grade_level_id
      and so.academic_year_id = v_period.academic_year_id
      and (so.term_id is null or v_period.term_id is null or so.term_id = v_period.term_id)
      and (ta.class_id is null or ta.class_id = p_class_id)
      and (so.class_id is null or so.class_id = p_class_id)
  );
end;
$$;

revoke all on function public.teacher_assigned_to_exam_class(uuid, uuid, uuid) from public;
revoke all on function public.teacher_assigned_to_exam_class(uuid, uuid, uuid) from anon, authenticated;

create or replace function public.can_read_exam_gradebook(p_gradebook_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gb public.exam_gradebooks%rowtype;
begin
  select * into v_gb
  from public.exam_gradebooks
  where id = p_gradebook_id
    and school_id = public.current_user_school_id();

  if not found then
    return false;
  end if;

  if public.has_academic_capability('GRADEBOOK_VIEW_ALL') then
    return true;
  end if;

  if public.has_academic_capability('GRADEBOOK_ENTER')
     and public.teacher_assigned_to_exam_class(v_gb.exam_id, v_gb.class_id, auth.uid()) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.can_read_exam_gradebook(uuid) from public;
grant execute on function public.can_read_exam_gradebook(uuid) to authenticated;

-- Eligible roster: active enrolment + enrolled student − exam exclusions.
-- CURRENT enrolment state (not as-of exam date). Limitation documented in Stage 1 docs.
create or replace function public.exam_gradebook_eligible_student_ids(
  p_exam_id uuid,
  p_class_id uuid
)
returns table (student_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_exam public.exams%rowtype;
  v_period public.exam_periods%rowtype;
  v_class public.classes%rowtype;
begin
  select * into v_exam
  from public.exams
  where id = p_exam_id and school_id = v_school and is_active;

  if not found then
    return;
  end if;

  select * into v_period
  from public.exam_periods
  where id = v_exam.exam_period_id and school_id = v_school;

  if not found then
    return;
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id and school_id = v_school;

  if not found then
    return;
  end if;

  if v_class.grade_level_id <> v_exam.grade_level_id
     or v_class.academic_year_id <> v_period.academic_year_id then
    return;
  end if;

  if v_exam.cohort_scope = 'CLASS'::public.exam_cohort_scope
     and v_exam.class_id is distinct from p_class_id then
    return;
  end if;

  return query
  select s.id
  from public.student_class_enrollments e
  join public.students s
    on s.id = e.student_id
   and s.school_id = v_school
  where e.school_id = v_school
    and e.class_id = p_class_id
    and e.academic_year_id = v_period.academic_year_id
    and e.status = 'active'::public.enrollment_status
    and s.status = 'enrolled'::public.student_status
    and not exists (
      select 1
      from public.exam_exclusions x
      where x.exam_id = p_exam_id
        and x.student_id = s.id
    )
  order by s.last_name, s.first_name, s.admission_number;
end;
$$;

revoke all on function public.exam_gradebook_eligible_student_ids(uuid, uuid) from public;
revoke all on function public.exam_gradebook_eligible_student_ids(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.exam_gradebooks enable row level security;
alter table public.exam_assessment_results enable row level security;

drop policy if exists "exam_gradebooks_select" on public.exam_gradebooks;
create policy "exam_gradebooks_select"
  on public.exam_gradebooks
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_read_exam_gradebook(id)
  );

drop policy if exists "exam_assessment_results_select" on public.exam_assessment_results;
create policy "exam_assessment_results_select"
  on public.exam_assessment_results
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_read_exam_gradebook(gradebook_id)
  );

revoke insert, update, delete on table public.exam_gradebooks
  from anon, authenticated;
revoke insert, update, delete on table public.exam_assessment_results
  from anon, authenticated;
grant select on table public.exam_gradebooks to authenticated;
grant select on table public.exam_assessment_results to authenticated;
