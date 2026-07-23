-- ===========================================================================
-- Phase 2B.1 polish — Exam references + simple exam status workflow
-- Additive only. No marks entry.
-- Reference format: EX-{YEAR}-T{n}-{SEQ4}  (or EX-{YEAR}-TY-{SEQ4} if no term)
-- Sequence scope: school + academic year + term code (concurrency-safe counter)
-- ===========================================================================

do $$ begin
  create type public.exam_lifecycle_status as enum (
    'DRAFT',
    'SCHEDULED',
    'READY',
    'COMPLETED',
    'ARCHIVED'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Counter table (never reuse numbers; gaps after deletes are fine)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_reference_counters (
  school_id         uuid not null references public.schools(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  term_code         text not null,
  last_value        integer not null default 0 check (last_value >= 0),
  updated_at        timestamptz not null default now(),
  primary key (school_id, academic_year_id, term_code),
  constraint exam_reference_counters_term_code_chk
    check (term_code ~ '^(T[1-4]|TY)$')
);

alter table public.exam_reference_counters enable row level security;

drop policy if exists "exam_reference_counters_select" on public.exam_reference_counters;
create policy "exam_reference_counters_select"
  on public.exam_reference_counters
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('EXAM_VIEW')
  );

revoke insert, update, delete on table public.exam_reference_counters
  from anon, authenticated;
grant select on table public.exam_reference_counters to authenticated;

-- ---------------------------------------------------------------------------
-- Exam columns
-- ---------------------------------------------------------------------------
alter table public.exams
  add column if not exists exam_reference text;

alter table public.exams
  add column if not exists status public.exam_lifecycle_status not null default 'DRAFT';

alter table public.exams
  add column if not exists status_changed_at timestamptz;

alter table public.exams
  add column if not exists status_changed_by uuid references public.profiles(id) on delete set null;

alter table public.exams
  add column if not exists status_reason text;

comment on column public.exams.exam_reference is
  'Immutable human-readable reference, e.g. EX-2026-T1-0001. Generated server-side.';

comment on column public.exams.status is
  'User-facing lifecycle: Draft → Scheduled → Ready → Completed → Archived.';

create unique index if not exists exams_school_reference_uidx
  on public.exams (school_id, exam_reference)
  where exam_reference is not null;

create index if not exists exams_reference_search_idx
  on public.exams (school_id, lower(exam_reference));

create index if not exists exams_status_idx
  on public.exams (school_id, status);

-- ---------------------------------------------------------------------------
-- Year / term helpers for references
-- ---------------------------------------------------------------------------
create or replace function public.exam_reference_year_label(p_academic_year_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text;
  v_year text;
begin
  select name into v_name
  from public.academic_years
  where id = p_academic_year_id;

  if v_name is null then
    raise exception 'Academic year not found for exam reference.';
  end if;

  v_year := substring(v_name from '([0-9]{4})');
  if v_year is null or length(v_year) <> 4 then
    -- Fallback: sanitize name to A-Z0-9 (max 8) if no year digits
    v_year := upper(regexp_replace(v_name, '[^0-9A-Za-z]', '', 'g'));
    v_year := left(coalesce(nullif(v_year, ''), 'YEAR'), 8);
  end if;
  return v_year;
end;
$$;

create or replace function public.exam_reference_term_code(p_term_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_num int;
begin
  if p_term_id is null then
    return 'TY';
  end if;
  select term_number into v_num from public.terms where id = p_term_id;
  if v_num is null or v_num < 1 or v_num > 4 then
    return 'TY';
  end if;
  return 'T' || v_num::text;
end;
$$;

create or replace function public.allocate_exam_reference(
  p_school_id uuid,
  p_academic_year_id uuid,
  p_term_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term_code text := public.exam_reference_term_code(p_term_id);
  v_year text := public.exam_reference_year_label(p_academic_year_id);
  v_next int;
  v_ref text;
begin
  insert into public.exam_reference_counters as c (
    school_id, academic_year_id, term_code, last_value, updated_at
  ) values (
    p_school_id, p_academic_year_id, v_term_code, 1, now()
  )
  on conflict (school_id, academic_year_id, term_code)
  do update set
    last_value = c.last_value + 1,
    updated_at = now()
  returning last_value into v_next;

  v_ref := format('EX-%s-%s-%s', v_year, v_term_code, lpad(v_next::text, 4, '0'));
  return v_ref;
end;
$$;

revoke all on function public.allocate_exam_reference(uuid, uuid, uuid) from public;
-- Internal use via SECURITY DEFINER RPCs only (no direct grant to authenticated)

-- ---------------------------------------------------------------------------
-- Backfill any existing exams (safe if empty)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_ref text;
  v_period public.exam_periods%rowtype;
begin
  for r in
    select e.id, e.school_id, e.exam_period_id
    from public.exams e
    where e.exam_reference is null
    order by e.created_at, e.id
    for update of e
  loop
    select * into v_period from public.exam_periods where id = r.exam_period_id;
    v_ref := public.allocate_exam_reference(
      r.school_id, v_period.academic_year_id, v_period.term_id
    );
    update public.exams
    set exam_reference = v_ref
    where id = r.id;
  end loop;
end $$;

alter table public.exams
  alter column exam_reference set not null;

-- ---------------------------------------------------------------------------
-- Blockers helper (plain-language missing items)
-- ---------------------------------------------------------------------------
create or replace function public.exam_status_blockers(
  p_exam_id uuid,
  p_target public.exam_lifecycle_status
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
  v_sched public.exam_schedules%rowtype;
  v_has_primary boolean := false;
  v_missing jsonb := '[]'::jsonb;
  v_conflicts jsonb;
begin
  select * into v_exam from public.exams where id = p_exam_id and school_id = v_school;
  if not found then
    return jsonb_build_array(jsonb_build_object(
      'code', 'EXAM_MISSING',
      'label', 'Exam not found'
    ));
  end if;

  select * into v_period from public.exam_periods where id = v_exam.exam_period_id;
  select * into v_sched from public.exam_schedules where exam_id = p_exam_id;
  if v_sched.id is not null then
    select exists (
      select 1 from public.exam_invigilators i
      where i.exam_schedule_id = v_sched.id and i.role = 'PRIMARY'
    ) into v_has_primary;
  end if;

  if p_target in ('SCHEDULED', 'READY', 'COMPLETED', 'ARCHIVED') then
    if v_period.status = 'ARCHIVED' then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'PERIOD_ARCHIVED',
        'label', 'Exam period is archived'
      ));
    end if;
    if not exists (select 1 from public.subjects s where s.id = v_exam.subject_id and s.is_active) then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'INACTIVE_SUBJECT',
        'label', 'Subject is inactive'
      ));
    end if;
    if v_sched.id is null then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'MISSING_SCHEDULE',
        'label', 'Date and time',
        'href_hint', 'schedule'
      ));
    else
      if v_sched.end_time <= v_sched.start_time then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'code', 'BAD_TIME',
          'label', 'End time must be after start time',
          'href_hint', 'schedule'
        ));
      end if;
      if v_period.opens_on is not null and v_sched.exam_date < v_period.opens_on then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'code', 'BEFORE_PERIOD',
          'label', 'Exam date is before the exam period opens',
          'href_hint', 'schedule'
        ));
      end if;
      if v_period.closes_on is not null and v_sched.exam_date > v_period.closes_on then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'code', 'AFTER_PERIOD',
          'label', 'Exam date is after the exam period closes',
          'href_hint', 'schedule'
        ));
      end if;

      v_conflicts := public.detect_exam_schedule_conflicts(
        p_exam_id,
        v_sched.exam_date,
        v_sched.start_time,
        v_sched.end_time,
        v_sched.room_id,
        (select staff_id from public.exam_invigilators
         where exam_schedule_id = v_sched.id and role = 'PRIMARY' limit 1),
        v_sched.id
      );
      if exists (
        select 1 from jsonb_array_elements(v_conflicts) w
        where w->>'code' in (
          'END_BEFORE_START', 'INACTIVE_SUBJECT', 'INACTIVE_ROOM',
          'INACTIVE_TEACHER', 'ROOM_MISSING', 'STAFF_MISSING', 'EXAM_MISSING',
          'ROOM_DOUBLE_BOOKED', 'TEACHER_DOUBLE_BOOKED', 'GRADE_DOUBLE_BOOKED'
        )
      ) then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'code', 'SCHEDULE_CONFLICT',
          'label', 'Unresolved schedule conflict',
          'href_hint', 'schedule'
        ));
      end if;
    end if;
  end if;

  if p_target in ('READY', 'COMPLETED', 'ARCHIVED') then
    if v_sched.id is null or v_sched.room_id is null then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'MISSING_ROOM',
        'label', 'Room',
        'href_hint', 'schedule'
      ));
    end if;
    if not coalesce(v_has_primary, false) then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'MISSING_INVIGILATOR',
        'label', 'Primary invigilator',
        'href_hint', 'schedule'
      ));
    end if;
    if v_exam.cohort_scope is null then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'MISSING_COHORT',
        'label', 'Student group (grade or class)'
      ));
    end if;
  end if;

  if p_target = 'COMPLETED' then
    if v_sched.id is not null
       and (v_sched.exam_date::timestamp + v_sched.start_time)
           > (now() + interval '1 day') then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'code', 'TOO_FAR_FUTURE',
        'label', 'Exam date is still more than a day in the future'
      ));
    end if;
  end if;

  return v_missing;
end;
$$;

revoke all on function public.exam_status_blockers(uuid, public.exam_lifecycle_status) from public;
grant execute on function public.exam_status_blockers(uuid, public.exam_lifecycle_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Status transition RPC
-- ---------------------------------------------------------------------------
create or replace function public.transition_exam_status(
  p_exam_id uuid,
  p_new_status public.exam_lifecycle_status,
  p_reason text default null,
  p_force_future_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_exam public.exams%rowtype;
  v_period public.exam_periods%rowtype;
  v_old public.exam_lifecycle_status;
  v_new public.exam_lifecycle_status := p_new_status;
  v_missing jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_event text;
  v_subject text;
  v_grade text;
begin
  perform public.require_academic_capability('EXAMS_MANAGE');

  select * into v_exam from public.exams where id = p_exam_id and school_id = v_school for update;
  if not found then
    raise exception 'Exam not found.';
  end if;
  select * into v_period from public.exam_periods where id = v_exam.exam_period_id;
  select name into v_subject from public.subjects where id = v_exam.subject_id;
  select name into v_grade from public.grade_levels where id = v_exam.grade_level_id;

  v_old := v_exam.status;

  if v_old = v_new then
    return jsonb_build_object('ok', true, 'status', v_new, 'exam_reference', v_exam.exam_reference);
  end if;

  -- Forward transitions
  if v_old = 'DRAFT' and v_new = 'SCHEDULED' then
    null;
  elsif v_old = 'SCHEDULED' and v_new = 'READY' then
    null;
  elsif v_old = 'READY' and v_new = 'COMPLETED' then
    null;
  elsif v_old = 'COMPLETED' and v_new = 'ARCHIVED' then
    null;
  -- Allowed reversals
  elsif v_old = 'SCHEDULED' and v_new = 'DRAFT' then
    null;
  elsif v_old = 'READY' and v_new = 'SCHEDULED' then
    null;
  elsif v_old = 'COMPLETED' and v_new = 'READY' then
    null;
  elsif v_old = 'ARCHIVED' and v_new = 'COMPLETED' then
    null;
  else
    raise exception 'That status change is not allowed. Move step by step: Draft → Scheduled → Ready → Completed → Archived.';
  end if;

  -- Backward moves from Ready / Completed / Archived need a reason
  if (
    (v_old = 'READY' and v_new = 'SCHEDULED')
    or (v_old = 'COMPLETED' and v_new in ('READY', 'SCHEDULED', 'DRAFT'))
    or (v_old = 'ARCHIVED' and v_new <> 'ARCHIVED')
  ) and v_reason is null then
    raise exception 'Please enter a short reason before changing this status backward.';
  end if;

  if v_new in ('SCHEDULED', 'READY', 'COMPLETED', 'ARCHIVED') then
    v_missing := public.exam_status_blockers(p_exam_id, v_new);
    -- Allow override only for TOO_FAR_FUTURE when completing
    if p_force_future_complete and v_new = 'COMPLETED' then
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      into v_missing
      from jsonb_array_elements(v_missing) x
      where x->>'code' <> 'TOO_FAR_FUTURE';
    end if;
    if jsonb_array_length(coalesce(v_missing, '[]'::jsonb)) > 0 then
      return jsonb_build_object(
        'ok', false,
        'status', v_old,
        'exam_reference', v_exam.exam_reference,
        'missing', v_missing,
        'message', format(
          'This exam cannot be marked as %s yet.',
          initcap(lower(replace(v_new::text, '_', ' ')))
        )
      );
    end if;
  end if;

  update public.exams
  set
    status = v_new,
    status_changed_at = now(),
    status_changed_by = auth.uid(),
    status_reason = v_reason,
    updated_at = now(),
    is_active = case when v_new = 'ARCHIVED' then false else true end
  where id = p_exam_id;

  v_event := case v_new
    when 'SCHEDULED' then 'EXAM_MARKED_SCHEDULED'
    when 'READY' then 'EXAM_MARKED_READY'
    when 'COMPLETED' then 'EXAM_MARKED_COMPLETED'
    when 'ARCHIVED' then 'EXAM_ARCHIVED'
    when 'DRAFT' then 'EXAM_RETURNED_TO_DRAFT'
    else 'EXAM_STATUS_CHANGED'
  end;
  if v_old = 'ARCHIVED' and v_new = 'COMPLETED' then
    v_event := 'EXAM_REOPENED';
  end if;

  perform public.log_academic_event(
    v_event,
    'exam',
    p_exam_id,
    jsonb_build_object(
      'exam_id', p_exam_id,
      'exam_reference', v_exam.exam_reference,
      'exam_period_id', v_exam.exam_period_id,
      'exam_period_name', v_period.name,
      'subject', v_subject,
      'grade', v_grade,
      'cohort_scope', v_exam.cohort_scope,
      'previous_status', v_old,
      'new_status', v_new,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', v_new,
    'exam_reference', v_exam.exam_reference,
    'missing', '[]'::jsonb
  );
end;
$$;

revoke all on function public.transition_exam_status(uuid, public.exam_lifecycle_status, text, boolean) from public;
grant execute on function public.transition_exam_status(uuid, public.exam_lifecycle_status, text, boolean) to authenticated;

-- Enum comparison for lifecycle: use explicit ordering helper instead of < on enum
-- Fix transition function: PostgreSQL enums compare by declaration order which matches our intent.
-- READY < COMPLETED is true. Good.

-- ---------------------------------------------------------------------------
-- Replace upsert_exam to assign immutable references + Draft on create
-- ---------------------------------------------------------------------------
create or replace function public.upsert_exam(
  p_id uuid default null,
  p_exam_period_id uuid default null,
  p_subject_id uuid default null,
  p_grade_level_id uuid default null,
  p_class_id uuid default null,
  p_assessment_type_id uuid default null,
  p_max_marks numeric default null,
  p_instructions text default null,
  p_notes text default null,
  p_cohort_scope public.exam_cohort_scope default 'GRADE'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_id uuid;
  v_scope public.exam_cohort_scope := coalesce(p_cohort_scope, 'GRADE');
  v_class uuid := p_class_id;
  v_period public.exam_periods%rowtype;
  v_ref text;
  v_existing public.exams%rowtype;
begin
  perform public.require_academic_capability('EXAMS_MANAGE');

  if p_exam_period_id is null or p_subject_id is null or p_grade_level_id is null
     or p_assessment_type_id is null or p_max_marks is null then
    raise exception 'Exam period, subject, grade, assessment type and maximum marks are required.';
  end if;
  if p_max_marks <= 0 then
    raise exception 'Maximum marks must be greater than zero.';
  end if;

  select * into v_period from public.exam_periods
  where id = p_exam_period_id and school_id = v_school and status <> 'ARCHIVED';
  if not found then
    raise exception 'Exam period not found or is archived.';
  end if;
  if not exists (select 1 from public.subjects s where s.id = p_subject_id and s.school_id = v_school and s.is_active) then
    raise exception 'Subject not found or inactive.';
  end if;
  if not exists (select 1 from public.grade_levels g where g.id = p_grade_level_id and g.school_id = v_school) then
    raise exception 'Grade not found.';
  end if;
  if not exists (
    select 1 from public.assessment_types a
    where a.id = p_assessment_type_id and a.school_id = v_school and a.is_active
  ) then
    raise exception 'Assessment type not found or inactive.';
  end if;

  if v_scope = 'CLASS' then
    if v_class is null then
      raise exception 'Choose a class when students taking this exam are limited to one class.';
    end if;
    if not exists (
      select 1 from public.classes c
      where c.id = v_class and c.school_id = v_school and c.grade_level_id = p_grade_level_id
    ) then
      raise exception 'Class does not belong to the selected grade.';
    end if;
  else
    v_class := null;
  end if;

  if p_id is null then
    v_ref := public.allocate_exam_reference(v_school, v_period.academic_year_id, v_period.term_id);
    insert into public.exams (
      school_id, exam_period_id, subject_id, grade_level_id, class_id,
      assessment_type_id, max_marks, instructions, notes, cohort_scope,
      exam_reference, status
    ) values (
      v_school, p_exam_period_id, p_subject_id, p_grade_level_id, v_class,
      p_assessment_type_id, p_max_marks,
      nullif(btrim(coalesce(p_instructions, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_scope,
      v_ref,
      'DRAFT'
    )
    returning id into v_id;

    perform public.log_academic_event(
      'EXAM_CREATED', 'exam', v_id,
      jsonb_build_object(
        'exam_period_id', p_exam_period_id,
        'max_marks', p_max_marks,
        'exam_reference', v_ref,
        'status', 'DRAFT'
      )
    );
    perform public.log_academic_event(
      'EXAM_REFERENCE_ASSIGNED', 'exam', v_id,
      jsonb_build_object('exam_reference', v_ref)
    );
  else
    select * into v_existing from public.exams
    where id = p_id and school_id = v_school and exam_period_id = p_exam_period_id
    for update;
    if not found then
      raise exception 'Exam not found.';
    end if;
    if v_existing.status in ('COMPLETED', 'ARCHIVED') then
      raise exception 'Completed or archived exams cannot be edited. Reopen the status first if needed.';
    end if;
    if v_existing.status = 'READY' then
      raise exception 'Ready exams have restricted edits. Return to Scheduled before changing details.';
    end if;

    update public.exams
    set
      subject_id = p_subject_id,
      grade_level_id = p_grade_level_id,
      class_id = v_class,
      assessment_type_id = p_assessment_type_id,
      max_marks = p_max_marks,
      instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      cohort_scope = v_scope,
      updated_at = now()
    where id = p_id
    returning id into v_id;

    perform public.log_academic_event(
      'EXAM_UPDATED', 'exam', v_id,
      jsonb_build_object(
        'exam_period_id', p_exam_period_id,
        'max_marks', p_max_marks,
        'exam_reference', v_existing.exam_reference
      )
    );
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'An exam for this subject, grade and assessment type already exists in this period.';
end;
$$;

revoke all on function public.upsert_exam(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, public.exam_cohort_scope) from public;
grant execute on function public.upsert_exam(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, public.exam_cohort_scope) to authenticated;

-- ---------------------------------------------------------------------------
-- Duplicate period: new references, always Draft (never copy lifecycle)
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_exam_period(
  p_source_period_id uuid,
  p_new_name text,
  p_academic_year_id uuid default null,
  p_term_id uuid default null,
  p_copy_exams boolean default true,
  p_copy_schedules boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_src public.exam_periods%rowtype;
  v_new_id uuid;
  v_name text := nullif(btrim(coalesce(p_new_name, '')), '');
  r record;
  v_exam_id uuid;
  v_sched_id uuid;
  v_ref text;
  v_year uuid;
  v_term uuid;
begin
  perform public.require_academic_capability('EXAM_PERIODS_MANAGE');
  if v_name is null then
    raise exception 'New exam period name is required.';
  end if;

  select * into v_src from public.exam_periods
  where id = p_source_period_id and school_id = v_school;
  if not found then
    raise exception 'Source exam period not found.';
  end if;

  v_year := coalesce(p_academic_year_id, v_src.academic_year_id);
  v_term := coalesce(p_term_id, v_src.term_id);

  insert into public.exam_periods (
    school_id, academic_year_id, term_id, name, description,
    opens_on, closes_on, status, created_by
  ) values (
    v_school, v_year, v_term, v_name, v_src.description,
    null, null, 'DRAFT', auth.uid()
  )
  returning id into v_new_id;

  perform public.log_academic_event(
    'EXAM_PERIOD_CREATED', 'exam_period', v_new_id,
    jsonb_build_object(
      'name', v_name,
      'duplicated_from', p_source_period_id,
      'copy_exams', p_copy_exams
    )
  );

  if p_copy_exams then
    for r in
      select * from public.exams
      where exam_period_id = p_source_period_id and school_id = v_school and is_active
        and status <> 'ARCHIVED'
    loop
      v_ref := public.allocate_exam_reference(v_school, v_year, v_term);
      insert into public.exams (
        school_id, exam_period_id, subject_id, grade_level_id, class_id,
        assessment_type_id, title, max_marks, instructions, notes, cohort_scope,
        exam_reference, status
      ) values (
        v_school, v_new_id, r.subject_id, r.grade_level_id, r.class_id,
        r.assessment_type_id, r.title, r.max_marks, r.instructions, r.notes, r.cohort_scope,
        v_ref, 'DRAFT'
      )
      returning id into v_exam_id;

      perform public.log_academic_event(
        'EXAM_CREATED', 'exam', v_exam_id,
        jsonb_build_object(
          'duplicated_from', r.id,
          'exam_period_id', v_new_id,
          'exam_reference', v_ref,
          'source_reference', r.exam_reference,
          'status', 'DRAFT'
        )
      );
      perform public.log_academic_event(
        'EXAM_REFERENCE_ASSIGNED', 'exam', v_exam_id,
        jsonb_build_object('exam_reference', v_ref)
      );

      if p_copy_schedules then
        insert into public.exam_schedules (
          school_id, exam_id, exam_date, start_time, end_time, room_id, capacity_override, notes
        )
        select v_school, v_exam_id, s.exam_date, s.start_time, s.end_time, s.room_id, s.capacity_override, s.notes
        from public.exam_schedules s
        where s.exam_id = r.id
        returning id into v_sched_id;
      end if;
    end loop;
  end if;

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_exam_period(uuid, text, uuid, uuid, boolean, boolean) from public;
grant execute on function public.duplicate_exam_period(uuid, text, uuid, uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Apply template: new references + Draft
-- ---------------------------------------------------------------------------
create or replace function public.apply_exam_template(
  p_template_id uuid,
  p_exam_period_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  r record;
  v_count int := 0;
  v_exam_id uuid;
  v_period public.exam_periods%rowtype;
  v_ref text;
begin
  perform public.require_academic_capability('EXAM_TEMPLATES_MANAGE');
  if not exists (select 1 from public.exam_templates t where t.id = p_template_id and t.school_id = v_school and t.is_active) then
    raise exception 'Template not found.';
  end if;
  select * into v_period from public.exam_periods
  where id = p_exam_period_id and school_id = v_school and status <> 'ARCHIVED';
  if not found then
    raise exception 'Exam period not found or archived.';
  end if;

  for r in
    select * from public.exam_template_items
    where exam_template_id = p_template_id and school_id = v_school
    order by display_order, subject_id
  loop
    begin
      v_ref := public.allocate_exam_reference(v_school, v_period.academic_year_id, v_period.term_id);
      insert into public.exams (
        school_id, exam_period_id, subject_id, grade_level_id, assessment_type_id,
        max_marks, instructions, cohort_scope, exam_reference, status
      ) values (
        v_school, p_exam_period_id, r.subject_id, r.grade_level_id, r.assessment_type_id,
        r.max_marks, r.instructions, 'GRADE', v_ref, 'DRAFT'
      )
      returning id into v_exam_id;
      v_count := v_count + 1;
      perform public.log_academic_event(
        'EXAM_CREATED', 'exam', v_exam_id,
        jsonb_build_object('from_template', p_template_id, 'exam_reference', v_ref, 'status', 'DRAFT')
      );
      perform public.log_academic_event(
        'EXAM_REFERENCE_ASSIGNED', 'exam', v_exam_id,
        jsonb_build_object('exam_reference', v_ref)
      );
    exception when unique_violation then
      null;
    end;
  end loop;

  perform public.log_academic_event(
    'EXAM_TEMPLATE_USED', 'exam_template', p_template_id,
    jsonb_build_object('action', 'applied', 'exam_period_id', p_exam_period_id, 'created', v_count)
  );
  return v_count;
end;
$$;

revoke all on function public.apply_exam_template(uuid, uuid) from public;
grant execute on function public.apply_exam_template(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Period archive: warn when non-archived exams still need attention
-- ---------------------------------------------------------------------------
create or replace function public.set_exam_period_status(
  p_period_id uuid,
  p_status public.exam_period_status,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_count int;
  v_open int;
begin
  perform public.require_academic_capability('EXAM_PERIODS_MANAGE');

  if p_status = 'ARCHIVED' and not coalesce(p_force, false) then
    select count(*) into v_open
    from public.exams e
    where e.exam_period_id = p_period_id
      and e.school_id = v_school
      and e.status not in ('COMPLETED', 'ARCHIVED');
    if v_open > 0 then
      return jsonb_build_object(
        'ok', false,
        'requires_confirmation', true,
        'message', format(
          '%s exam(s) are not completed or archived yet. Archive the period anyway only if you are sure.',
          v_open
        ),
        'open_exam_count', v_open
      );
    end if;
  end if;

  update public.exam_periods
  set status = p_status, updated_at = now()
  where id = p_period_id and school_id = v_school;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Exam period not found.';
  end if;

  if p_status = 'ARCHIVED' then
    perform public.log_academic_event(
      'EXAM_PERIOD_ARCHIVED', 'exam_period', p_period_id,
      jsonb_build_object('status', p_status, 'forced', coalesce(p_force, false))
    );
  else
    perform public.log_academic_event(
      'EXAM_UPDATED', 'exam_period', p_period_id,
      jsonb_build_object('status', p_status, 'action', 'status_change')
    );
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- Drop old signature if present (1-arg), keep 2-arg
do $$ begin
  drop function if exists public.set_exam_period_status(uuid, public.exam_period_status);
exception when undefined_function then null;
end $$;

revoke all on function public.set_exam_period_status(uuid, public.exam_period_status, boolean) from public;
grant execute on function public.set_exam_period_status(uuid, public.exam_period_status, boolean) to authenticated;

-- Restrict schedule edits on Ready+ exams
create or replace function public.upsert_exam_schedule(
  p_exam_id uuid,
  p_exam_date date,
  p_start_time time,
  p_end_time time,
  p_room_id uuid default null,
  p_primary_invigilator_id uuid default null,
  p_assistant_invigilator_id uuid default null,
  p_notes text default null,
  p_capacity_override integer default null,
  p_allow_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_schedule_id uuid;
  v_warnings jsonb;
  v_existing uuid;
  v_exam public.exams%rowtype;
begin
  perform public.require_academic_capability('EXAM_SCHEDULE_MANAGE');

  select * into v_exam from public.exams where id = p_exam_id and school_id = v_school and is_active;
  if not found then
    raise exception 'Exam not found.';
  end if;
  if v_exam.status in ('READY', 'COMPLETED', 'ARCHIVED') then
    raise exception 'Return this exam to Scheduled (or Draft) before changing the timetable.';
  end if;
  if p_exam_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Date, start time and end time are required.';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time.';
  end if;
  if p_assistant_invigilator_id is not null and p_primary_invigilator_id is not null
     and p_assistant_invigilator_id = p_primary_invigilator_id then
    raise exception 'Primary and assistant invigilators must be different people.';
  end if;

  select id into v_existing from public.exam_schedules where exam_id = p_exam_id;

  v_warnings := public.detect_exam_schedule_conflicts(
    p_exam_id, p_exam_date, p_start_time, p_end_time,
    p_room_id, p_primary_invigilator_id, v_existing
  );

  if jsonb_array_length(v_warnings) > 0 and not coalesce(p_allow_warnings, false) then
    if exists (
      select 1 from jsonb_array_elements(v_warnings) w
      where w->>'code' in (
        'END_BEFORE_START', 'INACTIVE_SUBJECT', 'INACTIVE_ROOM',
        'INACTIVE_TEACHER', 'ROOM_MISSING', 'STAFF_MISSING', 'EXAM_MISSING'
      )
    ) then
      raise exception '%', (
        select string_agg(format('%s — %s', w->>'message', w->>'fix'), ' ')
        from jsonb_array_elements(v_warnings) w
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'schedule_id', v_existing,
      'warnings', v_warnings,
      'requires_confirmation', true,
      'exam_reference', v_exam.exam_reference
    );
  end if;

  if v_existing is null then
    insert into public.exam_schedules (
      school_id, exam_id, exam_date, start_time, end_time,
      room_id, capacity_override, notes
    ) values (
      v_school, p_exam_id, p_exam_date, p_start_time, p_end_time,
      p_room_id, p_capacity_override, nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning id into v_schedule_id;
  else
    update public.exam_schedules
    set
      exam_date = p_exam_date,
      start_time = p_start_time,
      end_time = p_end_time,
      room_id = p_room_id,
      capacity_override = p_capacity_override,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
    where id = v_existing
    returning id into v_schedule_id;
  end if;

  delete from public.exam_invigilators where exam_schedule_id = v_schedule_id;

  if p_primary_invigilator_id is not null then
    insert into public.exam_invigilators (school_id, exam_schedule_id, staff_id, role)
    values (v_school, v_schedule_id, p_primary_invigilator_id, 'PRIMARY');
    perform public.log_academic_event(
      'INVIGILATOR_ASSIGNED', 'exam_invigilator', v_schedule_id,
      jsonb_build_object(
        'staff_id', p_primary_invigilator_id,
        'role', 'PRIMARY',
        'exam_reference', v_exam.exam_reference
      )
    );
  end if;

  if p_assistant_invigilator_id is not null then
    insert into public.exam_invigilators (school_id, exam_schedule_id, staff_id, role)
    values (v_school, v_schedule_id, p_assistant_invigilator_id, 'ASSISTANT');
    perform public.log_academic_event(
      'INVIGILATOR_ASSIGNED', 'exam_invigilator', v_schedule_id,
      jsonb_build_object(
        'staff_id', p_assistant_invigilator_id,
        'role', 'ASSISTANT',
        'exam_reference', v_exam.exam_reference
      )
    );
  end if;

  if p_room_id is not null then
    perform public.log_academic_event(
      'ROOM_ASSIGNED', 'exam_schedule', v_schedule_id,
      jsonb_build_object(
        'room_id', p_room_id,
        'exam_id', p_exam_id,
        'exam_reference', v_exam.exam_reference
      )
    );
  end if;

  perform public.log_academic_event(
    'TIMETABLE_UPDATED', 'exam_schedule', v_schedule_id,
    jsonb_build_object(
      'exam_id', p_exam_id,
      'exam_reference', v_exam.exam_reference,
      'exam_date', p_exam_date,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'warning_count', jsonb_array_length(coalesce(v_warnings, '[]'::jsonb))
    )
  );

  return jsonb_build_object(
    'ok', true,
    'schedule_id', v_schedule_id,
    'warnings', coalesce(v_warnings, '[]'::jsonb),
    'requires_confirmation', false,
    'exam_reference', v_exam.exam_reference
  );
end;
$$;

revoke all on function public.upsert_exam_schedule(uuid, date, time, time, uuid, uuid, uuid, text, integer, boolean) from public;
grant execute on function public.upsert_exam_schedule(uuid, date, time, time, uuid, uuid, uuid, text, integer, boolean) to authenticated;
