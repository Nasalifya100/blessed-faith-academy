-- ===========================================================================
-- Phase 2B.2 — Exam period / exam / schedule / template / bulk RPCs
-- No marks entry RPCs.
-- ===========================================================================

create or replace function public.upsert_exam_period(
  p_id uuid default null,
  p_academic_year_id uuid default null,
  p_term_id uuid default null,
  p_name text default null,
  p_description text default null,
  p_opens_on date default null,
  p_closes_on date default null,
  p_status public.exam_period_status default 'DRAFT'
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
  v_year public.academic_years%rowtype;
begin
  perform public.require_academic_capability('EXAM_PERIODS_MANAGE');
  if v_name is null then
    raise exception 'Exam period name is required.';
  end if;
  if p_academic_year_id is null then
    raise exception 'Academic year is required.';
  end if;
  if p_opens_on is not null and p_closes_on is not null and p_closes_on < p_opens_on then
    raise exception 'Closing date must be on or after the opening date.';
  end if;

  select * into v_year from public.academic_years
  where id = p_academic_year_id and school_id = v_school;
  if not found then
    raise exception 'Academic year not found.';
  end if;

  if p_term_id is not null and not exists (
    select 1 from public.terms t
    where t.id = p_term_id and t.school_id = v_school and t.academic_year_id = p_academic_year_id
  ) then
    raise exception 'Term does not belong to the selected academic year.';
  end if;

  if p_id is null then
    insert into public.exam_periods (
      school_id, academic_year_id, term_id, name, description,
      opens_on, closes_on, status, created_by
    ) values (
      v_school, p_academic_year_id, p_term_id, v_name,
      nullif(btrim(coalesce(p_description, '')), ''),
      p_opens_on, p_closes_on, coalesce(p_status, 'DRAFT'), auth.uid()
    )
    returning id into v_id;
    perform public.log_academic_event(
      'EXAM_PERIOD_CREATED', 'exam_period', v_id,
      jsonb_build_object('name', v_name, 'status', coalesce(p_status, 'DRAFT'))
    );
  else
    update public.exam_periods
    set
      academic_year_id = p_academic_year_id,
      term_id = p_term_id,
      name = v_name,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      opens_on = p_opens_on,
      closes_on = p_closes_on,
      status = coalesce(p_status, status),
      updated_at = now()
    where id = p_id and school_id = v_school
    returning id into v_id;
    if v_id is null then
      raise exception 'Exam period not found.';
    end if;
    perform public.log_academic_event(
      'EXAM_UPDATED', 'exam_period', v_id,
      jsonb_build_object('name', v_name, 'status', coalesce(p_status, 'DRAFT'), 'action', 'period_updated')
    );
  end if;
  return v_id;
end;
$$;

revoke all on function public.upsert_exam_period(uuid, uuid, uuid, text, text, date, date, public.exam_period_status) from public;
grant execute on function public.upsert_exam_period(uuid, uuid, uuid, text, text, date, date, public.exam_period_status) to authenticated;

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
  v_map jsonb := '{}'::jsonb;
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

  insert into public.exam_periods (
    school_id, academic_year_id, term_id, name, description,
    opens_on, closes_on, status, created_by
  ) values (
    v_school,
    coalesce(p_academic_year_id, v_src.academic_year_id),
    coalesce(p_term_id, v_src.term_id),
    v_name,
    v_src.description,
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
    loop
      insert into public.exams (
        school_id, exam_period_id, subject_id, grade_level_id, class_id,
        assessment_type_id, title, max_marks, instructions, notes, cohort_scope
      ) values (
        v_school, v_new_id, r.subject_id, r.grade_level_id, r.class_id,
        r.assessment_type_id, r.title, r.max_marks, r.instructions, r.notes, r.cohort_scope
      )
      returning id into v_exam_id;
      v_map := v_map || jsonb_build_object(r.id::text, v_exam_id::text);

      perform public.log_academic_event(
        'EXAM_CREATED', 'exam', v_exam_id,
        jsonb_build_object('duplicated_from', r.id, 'exam_period_id', v_new_id)
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

create or replace function public.set_exam_period_status(
  p_period_id uuid,
  p_status public.exam_period_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_count int;
begin
  perform public.require_academic_capability('EXAM_PERIODS_MANAGE');
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
      jsonb_build_object('status', p_status)
    );
  else
    perform public.log_academic_event(
      'EXAM_UPDATED', 'exam_period', p_period_id,
      jsonb_build_object('status', p_status, 'action', 'status_change')
    );
  end if;
end;
$$;

revoke all on function public.set_exam_period_status(uuid, public.exam_period_status) from public;
grant execute on function public.set_exam_period_status(uuid, public.exam_period_status) to authenticated;

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
begin
  perform public.require_academic_capability('EXAMS_MANAGE');

  if p_exam_period_id is null or p_subject_id is null or p_grade_level_id is null
     or p_assessment_type_id is null or p_max_marks is null then
    raise exception 'Exam period, subject, grade, assessment type and maximum marks are required.';
  end if;
  if p_max_marks <= 0 then
    raise exception 'Maximum marks must be greater than zero.';
  end if;

  if not exists (
    select 1 from public.exam_periods ep
    where ep.id = p_exam_period_id and ep.school_id = v_school and ep.status <> 'ARCHIVED'
  ) then
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
    insert into public.exams (
      school_id, exam_period_id, subject_id, grade_level_id, class_id,
      assessment_type_id, max_marks, instructions, notes, cohort_scope
    ) values (
      v_school, p_exam_period_id, p_subject_id, p_grade_level_id, v_class,
      p_assessment_type_id, p_max_marks,
      nullif(btrim(coalesce(p_instructions, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_scope
    )
    returning id into v_id;
    perform public.log_academic_event(
      'EXAM_CREATED', 'exam', v_id,
      jsonb_build_object('exam_period_id', p_exam_period_id, 'max_marks', p_max_marks)
    );
  else
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
    where id = p_id and school_id = v_school and exam_period_id = p_exam_period_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Exam not found.';
    end if;
    perform public.log_academic_event(
      'EXAM_UPDATED', 'exam', v_id,
      jsonb_build_object('exam_period_id', p_exam_period_id, 'max_marks', p_max_marks)
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
begin
  perform public.require_academic_capability('EXAM_SCHEDULE_MANAGE');

  if not exists (select 1 from public.exams e where e.id = p_exam_id and e.school_id = v_school and e.is_active) then
    raise exception 'Exam not found.';
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
    -- Hard-block invalid duration / inactive entities; soft warnings need allow flag
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
      'requires_confirmation', true
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
      jsonb_build_object('staff_id', p_primary_invigilator_id, 'role', 'PRIMARY')
    );
  end if;

  if p_assistant_invigilator_id is not null then
    insert into public.exam_invigilators (school_id, exam_schedule_id, staff_id, role)
    values (v_school, v_schedule_id, p_assistant_invigilator_id, 'ASSISTANT');
    perform public.log_academic_event(
      'INVIGILATOR_ASSIGNED', 'exam_invigilator', v_schedule_id,
      jsonb_build_object('staff_id', p_assistant_invigilator_id, 'role', 'ASSISTANT')
    );
  end if;

  if p_room_id is not null then
    perform public.log_academic_event(
      'ROOM_ASSIGNED', 'exam_schedule', v_schedule_id,
      jsonb_build_object('room_id', p_room_id, 'exam_id', p_exam_id)
    );
  end if;

  perform public.log_academic_event(
    'TIMETABLE_UPDATED', 'exam_schedule', v_schedule_id,
    jsonb_build_object(
      'exam_id', p_exam_id,
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
    'requires_confirmation', false
  );
end;
$$;

revoke all on function public.upsert_exam_schedule(uuid, date, time, time, uuid, uuid, uuid, text, integer, boolean) from public;
grant execute on function public.upsert_exam_schedule(uuid, date, time, time, uuid, uuid, uuid, text, integer, boolean) to authenticated;

create or replace function public.upsert_exam_exclusion(
  p_exam_id uuid,
  p_student_id uuid,
  p_reason public.exam_exclusion_reason default 'OTHER',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_id uuid;
begin
  perform public.require_academic_capability('EXAMS_MANAGE');
  if not exists (select 1 from public.exams e where e.id = p_exam_id and e.school_id = v_school) then
    raise exception 'Exam not found.';
  end if;
  if not exists (select 1 from public.students s where s.id = p_student_id and s.school_id = v_school) then
    raise exception 'Student not found.';
  end if;

  insert into public.exam_exclusions (school_id, exam_id, student_id, reason, notes, created_by)
  values (
    v_school, p_exam_id, p_student_id, coalesce(p_reason, 'OTHER'),
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  )
  on conflict (exam_id, student_id) do update
    set reason = excluded.reason,
        notes = excluded.notes
  returning id into v_id;

  perform public.log_academic_event(
    'EXAM_UPDATED', 'exam_exclusion', v_id,
    jsonb_build_object('exam_id', p_exam_id, 'student_id', p_student_id, 'reason', p_reason)
  );
  return v_id;
end;
$$;

revoke all on function public.upsert_exam_exclusion(uuid, uuid, public.exam_exclusion_reason, text) from public;
grant execute on function public.upsert_exam_exclusion(uuid, uuid, public.exam_exclusion_reason, text) to authenticated;

create or replace function public.remove_exam_exclusion(p_exclusion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
begin
  perform public.require_academic_capability('EXAMS_MANAGE');
  delete from public.exam_exclusions
  where id = p_exclusion_id and school_id = v_school;
  if not found then
    raise exception 'Exclusion not found.';
  end if;
end;
$$;

revoke all on function public.remove_exam_exclusion(uuid) from public;
grant execute on function public.remove_exam_exclusion(uuid) to authenticated;

create or replace function public.save_exam_template_from_period(
  p_period_id uuid,
  p_template_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_template_name, '')), '');
  r record;
  v_ord int := 0;
begin
  perform public.require_academic_capability('EXAM_TEMPLATES_MANAGE');
  if v_name is null then
    raise exception 'Template name is required.';
  end if;
  if not exists (select 1 from public.exam_periods where id = p_period_id and school_id = v_school) then
    raise exception 'Exam period not found.';
  end if;

  insert into public.exam_templates (school_id, name, description, source_exam_period_id)
  values (v_school, v_name, nullif(btrim(coalesce(p_description, '')), ''), p_period_id)
  returning id into v_id;

  for r in
    select e.*, s.room_id,
      extract(epoch from (s.end_time - s.start_time)) / 60 as duration_minutes
    from public.exams e
    left join public.exam_schedules s on s.exam_id = e.id
    where e.exam_period_id = p_period_id and e.school_id = v_school and e.is_active
  loop
    v_ord := v_ord + 1;
    insert into public.exam_template_items (
      school_id, exam_template_id, subject_id, grade_level_id, assessment_type_id,
      max_marks, default_duration_minutes, default_room_id, instructions, display_order
    ) values (
      v_school, v_id, r.subject_id, r.grade_level_id, r.assessment_type_id,
      r.max_marks, nullif(r.duration_minutes, 0)::int, r.room_id, r.instructions, v_ord
    );
  end loop;

  perform public.log_academic_event(
    'EXAM_TEMPLATE_USED', 'exam_template', v_id,
    jsonb_build_object('action', 'saved_from_period', 'period_id', p_period_id, 'name', v_name)
  );
  return v_id;
end;
$$;

revoke all on function public.save_exam_template_from_period(uuid, text, text) from public;
grant execute on function public.save_exam_template_from_period(uuid, text, text) to authenticated;

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
begin
  perform public.require_academic_capability('EXAM_TEMPLATES_MANAGE');
  if not exists (select 1 from public.exam_templates t where t.id = p_template_id and t.school_id = v_school and t.is_active) then
    raise exception 'Template not found.';
  end if;
  if not exists (
    select 1 from public.exam_periods ep
    where ep.id = p_exam_period_id and ep.school_id = v_school and ep.status <> 'ARCHIVED'
  ) then
    raise exception 'Exam period not found or archived.';
  end if;

  for r in
    select * from public.exam_template_items
    where exam_template_id = p_template_id and school_id = v_school
    order by display_order, subject_id
  loop
    begin
      insert into public.exams (
        school_id, exam_period_id, subject_id, grade_level_id, assessment_type_id,
        max_marks, instructions, cohort_scope
      ) values (
        v_school, p_exam_period_id, r.subject_id, r.grade_level_id, r.assessment_type_id,
        r.max_marks, r.instructions, 'GRADE'
      )
      returning id into v_exam_id;
      v_count := v_count + 1;
      perform public.log_academic_event(
        'EXAM_CREATED', 'exam', v_exam_id,
        jsonb_build_object('from_template', p_template_id)
      );
    exception when unique_violation then
      -- skip duplicates already present in period
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

create or replace function public.bulk_shift_exam_dates(
  p_exam_period_id uuid,
  p_day_offset integer
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_count int;
begin
  perform public.require_academic_capability('EXAM_SCHEDULE_MANAGE');
  if p_day_offset is null or p_day_offset = 0 then
    raise exception 'Day offset must be a non-zero number.';
  end if;

  update public.exam_schedules s
  set exam_date = s.exam_date + p_day_offset, updated_at = now()
  from public.exams e
  where s.exam_id = e.id
    and e.exam_period_id = p_exam_period_id
    and e.school_id = v_school;

  get diagnostics v_count = row_count;
  perform public.log_academic_event(
    'TIMETABLE_UPDATED', 'exam_period', p_exam_period_id,
    jsonb_build_object('action', 'bulk_shift_dates', 'day_offset', p_day_offset, 'updated', v_count)
  );
  return v_count;
end;
$$;

revoke all on function public.bulk_shift_exam_dates(uuid, integer) from public;
grant execute on function public.bulk_shift_exam_dates(uuid, integer) to authenticated;

create or replace function public.bulk_assign_room_to_period(
  p_exam_period_id uuid,
  p_room_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_count int;
begin
  perform public.require_academic_capability('EXAM_SCHEDULE_MANAGE');
  if not exists (select 1 from public.exam_rooms r where r.id = p_room_id and r.school_id = v_school and r.is_active) then
    raise exception 'Room not found or inactive.';
  end if;

  update public.exam_schedules s
  set room_id = p_room_id, updated_at = now()
  from public.exams e
  where s.exam_id = e.id
    and e.exam_period_id = p_exam_period_id
    and e.school_id = v_school;

  get diagnostics v_count = row_count;
  perform public.log_academic_event(
    'ROOM_ASSIGNED', 'exam_period', p_exam_period_id,
    jsonb_build_object('action', 'bulk_assign_room', 'room_id', p_room_id, 'updated', v_count)
  );
  return v_count;
end;
$$;

revoke all on function public.bulk_assign_room_to_period(uuid, uuid) from public;
grant execute on function public.bulk_assign_room_to_period(uuid, uuid) to authenticated;

create or replace function public.bulk_archive_closed_exam_periods()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_count int;
  r record;
begin
  perform public.require_academic_capability('EXAM_PERIODS_MANAGE');
  v_count := 0;
  for r in
    select id from public.exam_periods
    where school_id = v_school and status = 'CLOSED'
  loop
    update public.exam_periods set status = 'ARCHIVED', updated_at = now() where id = r.id;
    perform public.log_academic_event(
      'EXAM_PERIOD_ARCHIVED', 'exam_period', r.id,
      jsonb_build_object('action', 'bulk_archive')
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.bulk_archive_closed_exam_periods() from public;
grant execute on function public.bulk_archive_closed_exam_periods() to authenticated;
