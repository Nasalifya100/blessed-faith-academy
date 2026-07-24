-- ===========================================================================
-- Phase 2C Stage 1 — Gradebook SECURITY DEFINER RPCs
-- open_or_get / save_draft / submit / reopen / lock
-- ===========================================================================

create or replace function public.exam_allows_marks_entry(p_exam_id uuid)
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
  v_window public.academic_workflow_periods%rowtype;
  v_today date := current_date;
begin
  select * into v_exam
  from public.exams
  where id = p_exam_id and school_id = v_school and is_active;

  if not found then
    return false;
  end if;

  -- Stage 1: only Completed exams accept marks.
  if v_exam.status is distinct from 'COMPLETED'::public.exam_lifecycle_status then
    return false;
  end if;

  select * into v_period
  from public.exam_periods
  where id = v_exam.exam_period_id and school_id = v_school;

  if not found then
    return false;
  end if;

  -- If a MARKS_ENTRY workflow window is configured for this year/term, enforce it.
  select * into v_window
  from public.academic_workflow_periods w
  where w.school_id = v_school
    and w.is_active
    and w.workflow_type = 'MARKS_ENTRY'
    and w.academic_year_id = v_period.academic_year_id
    and (
      (v_period.term_id is null and w.term_id is null)
      or w.term_id = v_period.term_id
      or w.term_id is null
    )
  order by
    case when w.term_id is not null and w.term_id = v_period.term_id then 0 else 1 end,
    w.starts_at desc
  limit 1;

  if found then
    if v_today < v_window.starts_at then
      return false;
    end if;
    if v_window.ends_at is not null and v_today > v_window.ends_at then
      return false;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.exam_allows_marks_entry(uuid) from public;
revoke all on function public.exam_allows_marks_entry(uuid) from anon, authenticated;

create or replace function public.can_enter_exam_gradebook(
  p_exam_id uuid,
  p_class_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_academic_capability('GRADEBOOK_ENTER') then
    return false;
  end if;

  if public.is_administrator()
     or public.current_user_role() = 'headteacher'::public.staff_role then
    return true;
  end if;

  return public.teacher_assigned_to_exam_class(p_exam_id, p_class_id, auth.uid());
end;
$$;

revoke all on function public.can_enter_exam_gradebook(uuid, uuid) from public;
revoke all on function public.can_enter_exam_gradebook(uuid, uuid) from anon, authenticated;

create or replace function public.assert_exam_class_gradebook_scope(
  p_exam_id uuid,
  p_class_id uuid
)
returns void
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
  if v_school is null then
    raise exception 'No school context.';
  end if;

  select * into v_exam
  from public.exams
  where id = p_exam_id and school_id = v_school and is_active;

  if not found then
    raise exception 'Exam not found or inactive.';
  end if;

  select * into v_period
  from public.exam_periods
  where id = v_exam.exam_period_id and school_id = v_school;

  if not found then
    raise exception 'Exam period not found.';
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id and school_id = v_school;

  if not found then
    raise exception 'Class not found.';
  end if;

  if v_class.grade_level_id <> v_exam.grade_level_id then
    raise exception 'Class does not belong to the exam grade.';
  end if;

  if v_class.academic_year_id <> v_period.academic_year_id then
    raise exception 'Class academic year does not match the exam period.';
  end if;

  if v_exam.cohort_scope = 'CLASS'::public.exam_cohort_scope
     and v_exam.class_id is distinct from p_class_id then
    raise exception 'This exam is limited to a different class.';
  end if;
end;
$$;

revoke all on function public.assert_exam_class_gradebook_scope(uuid, uuid) from public;
revoke all on function public.assert_exam_class_gradebook_scope(uuid, uuid) from anon, authenticated;

create or replace function public.open_or_get_exam_gradebook(
  p_exam_id uuid,
  p_class_id uuid
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
  v_gb public.exam_gradebooks%rowtype;
  v_can_enter boolean;
  v_created boolean := false;
  v_roster jsonb;
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;

  perform public.assert_exam_class_gradebook_scope(p_exam_id, p_class_id);

  select * into v_exam from public.exams where id = p_exam_id and school_id = v_school;
  select * into v_period from public.exam_periods where id = v_exam.exam_period_id;

  v_can_enter := public.can_enter_exam_gradebook(p_exam_id, p_class_id);

  if not v_can_enter and not public.has_academic_capability('GRADEBOOK_VIEW_ALL') then
    raise exception 'You are not authorized to open this gradebook.';
  end if;

  select * into v_gb
  from public.exam_gradebooks
  where exam_id = p_exam_id and class_id = p_class_id and school_id = v_school;

  if not found then
    if not v_can_enter then
      raise exception 'Gradebook has not been opened yet.';
    end if;

    if not public.exam_allows_marks_entry(p_exam_id) then
      raise exception 'Marks entry is not available for this exam yet (requires Completed status and an open marks-entry window when configured).';
    end if;

    begin
      insert into public.exam_gradebooks (
        school_id, exam_id, class_id, status, revision, opened_by, opened_at
      ) values (
        v_school, p_exam_id, p_class_id, 'DRAFT', 1, auth.uid(), now()
      )
      returning * into v_gb;
      v_created := true;

      perform public.log_academic_event(
        'GRADEBOOK_OPENED',
        'exam_gradebook',
        v_gb.id,
        jsonb_build_object(
          'exam_id', p_exam_id,
          'class_id', p_class_id,
          'exam_reference', v_exam.exam_reference,
          'revision', v_gb.revision,
          'created', true
        )
      );
    exception
      when unique_violation then
        select * into v_gb
        from public.exam_gradebooks
        where exam_id = p_exam_id and class_id = p_class_id and school_id = v_school;

        if not found then
          raise;
        end if;

        -- Concurrent create won: only continue if caller may read the existing row.
        if not public.can_read_exam_gradebook(v_gb.id) then
          raise exception 'You are not authorized to open this gradebook.';
        end if;
        v_created := false;
    end;
  end if;

  -- Existing gradebooks remain readable after the marks window closes.
  if not public.can_read_exam_gradebook(v_gb.id) then
    raise exception 'You are not authorized to open this gradebook.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.last_name, r.first_name, r.admission_number), '[]'::jsonb)
  into v_roster
  from (
    select
      s.id as student_id,
      s.admission_number,
      s.first_name,
      s.last_name,
      s.status as student_status
    from public.exam_gradebook_eligible_student_ids(p_exam_id, p_class_id) e
    join public.students s on s.id = e.student_id
  ) r;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.student_id), '[]'::jsonb)
  into v_results
  from (
    select
      ar.id,
      ar.student_id,
      ar.entry_status,
      ar.marks_obtained,
      ar.max_marks_snapshot,
      ar.comment,
      ar.row_revision
    from public.exam_assessment_results ar
    where ar.gradebook_id = v_gb.id
  ) x;

  return jsonb_build_object(
    'gradebook', jsonb_build_object(
      'id', v_gb.id,
      'exam_id', v_gb.exam_id,
      'class_id', v_gb.class_id,
      'status', v_gb.status,
      'revision', v_gb.revision,
      'opened_by', v_gb.opened_by,
      'opened_at', v_gb.opened_at,
      'last_saved_at', v_gb.last_saved_at,
      'submitted_at', v_gb.submitted_at,
      'submitted_by', v_gb.submitted_by,
      'reopened_at', v_gb.reopened_at,
      'reopening_reason', v_gb.reopening_reason,
      'locked_at', v_gb.locked_at,
      'locked_by', v_gb.locked_by,
      'created', v_created
    ),
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'exam_reference', v_exam.exam_reference,
      'status', v_exam.status,
      'subject_id', v_exam.subject_id,
      'grade_level_id', v_exam.grade_level_id,
      'max_marks', v_exam.max_marks,
      'assessment_type_id', v_exam.assessment_type_id,
      'academic_year_id', v_period.academic_year_id,
      'term_id', v_period.term_id
    ),
    'roster', v_roster,
    'results', v_results,
    'can_edit',
      v_can_enter
      and v_gb.status in (
        'DRAFT'::public.gradebook_status,
        'REOPENED'::public.gradebook_status
      )
      and (
        public.exam_allows_marks_entry(p_exam_id)
        or (
          v_gb.status = 'REOPENED'::public.gradebook_status
          and public.has_academic_capability('GRADEBOOK_REOPEN')
        )
      )
  );
end;
$$;

revoke all on function public.open_or_get_exam_gradebook(uuid, uuid) from public;
grant execute on function public.open_or_get_exam_gradebook(uuid, uuid) to authenticated;

-- Authoritative read-by-ID (never creates). Used by /dashboard/gradebook/[id].
create or replace function public.get_exam_gradebook(p_gradebook_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_exam public.exams%rowtype;
  v_period public.exam_periods%rowtype;
  v_gb public.exam_gradebooks%rowtype;
  v_can_enter boolean;
  v_roster jsonb;
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;
  if p_gradebook_id is null then
    raise exception 'Gradebook not found.';
  end if;

  if not public.can_read_exam_gradebook(p_gradebook_id) then
    -- Same message for missing and forbidden (avoid existence leaks).
    raise exception 'Gradebook not found.';
  end if;

  select * into v_gb
  from public.exam_gradebooks
  where id = p_gradebook_id and school_id = v_school;

  if not found then
    raise exception 'Gradebook not found.';
  end if;

  select * into v_exam from public.exams where id = v_gb.exam_id and school_id = v_school;
  if not found then
    raise exception 'Gradebook not found.';
  end if;

  select * into v_period from public.exam_periods where id = v_exam.exam_period_id;
  if not found then
    raise exception 'Gradebook not found.';
  end if;

  v_can_enter := public.can_enter_exam_gradebook(v_gb.exam_id, v_gb.class_id);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.last_name, r.first_name, r.admission_number), '[]'::jsonb)
  into v_roster
  from (
    select
      s.id as student_id,
      s.admission_number,
      s.first_name,
      s.last_name,
      s.status as student_status
    from public.exam_gradebook_eligible_student_ids(v_gb.exam_id, v_gb.class_id) e
    join public.students s on s.id = e.student_id
  ) r;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.student_id), '[]'::jsonb)
  into v_results
  from (
    select
      ar.id,
      ar.student_id,
      ar.entry_status,
      ar.marks_obtained,
      ar.max_marks_snapshot,
      ar.comment,
      ar.row_revision
    from public.exam_assessment_results ar
    where ar.gradebook_id = v_gb.id
  ) x;

  return jsonb_build_object(
    'gradebook', jsonb_build_object(
      'id', v_gb.id,
      'exam_id', v_gb.exam_id,
      'class_id', v_gb.class_id,
      'status', v_gb.status,
      'revision', v_gb.revision,
      'opened_by', v_gb.opened_by,
      'opened_at', v_gb.opened_at,
      'last_saved_at', v_gb.last_saved_at,
      'submitted_at', v_gb.submitted_at,
      'submitted_by', v_gb.submitted_by,
      'reopened_at', v_gb.reopened_at,
      'reopening_reason', v_gb.reopening_reason,
      'locked_at', v_gb.locked_at,
      'locked_by', v_gb.locked_by,
      'created', false
    ),
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'exam_reference', v_exam.exam_reference,
      'status', v_exam.status,
      'subject_id', v_exam.subject_id,
      'grade_level_id', v_exam.grade_level_id,
      'max_marks', v_exam.max_marks,
      'assessment_type_id', v_exam.assessment_type_id,
      'academic_year_id', v_period.academic_year_id,
      'term_id', v_period.term_id
    ),
    'roster', v_roster,
    'results', v_results,
    'can_edit',
      v_can_enter
      and v_gb.status in (
        'DRAFT'::public.gradebook_status,
        'REOPENED'::public.gradebook_status
      )
      and (
        public.exam_allows_marks_entry(v_gb.exam_id)
        or (
          v_gb.status = 'REOPENED'::public.gradebook_status
          and public.has_academic_capability('GRADEBOOK_REOPEN')
        )
      )
  );
end;
$$;

revoke all on function public.get_exam_gradebook(uuid) from public;
grant execute on function public.get_exam_gradebook(uuid) to authenticated;

create or replace function public.save_exam_gradebook_draft(
  p_gradebook_id uuid,
  p_expected_revision integer,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_gb public.exam_gradebooks%rowtype;
  v_exam public.exams%rowtype;
  v_row jsonb;
  v_student uuid;
  v_status public.result_entry_status;
  v_marks numeric(8,2);
  v_comment text;
  v_eligible uuid[];
  v_seen uuid[] := array[]::uuid[];
  v_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_gb
  from public.exam_gradebooks
  where id = p_gradebook_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Gradebook not found.';
  end if;

  if not public.can_enter_exam_gradebook(v_gb.exam_id, v_gb.class_id) then
    raise exception 'You are not authorized to edit this gradebook.';
  end if;

  if v_gb.status not in (
    'DRAFT'::public.gradebook_status,
    'REOPENED'::public.gradebook_status
  ) then
    raise exception 'Submitted or locked gradebooks cannot be edited. Reopen is required.';
  end if;

  -- DRAFT requires an open marks window. REOPENED may be edited by elevated reopeners
  -- after the window closes (intentional correction path); assigned teachers still need
  -- the window unless they also hold GRADEBOOK_REOPEN.
  if v_gb.status = 'DRAFT'::public.gradebook_status then
    if not public.exam_allows_marks_entry(v_gb.exam_id) then
      raise exception 'Marks entry is not available for this exam.';
    end if;
  elsif not public.exam_allows_marks_entry(v_gb.exam_id)
        and not public.has_academic_capability('GRADEBOOK_REOPEN') then
    raise exception 'Marks entry window is closed. An authorised reopen is required to edit.';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_gb.revision then
    raise exception 'Gradebook was updated by someone else. Reload and try again. (revision conflict)';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Draft payload must be a JSON array of result rows.';
  end if;

  -- Semantics: partial upsert of provided rows only. Omitted students are left unchanged
  -- (not deleted). Submit still requires every eligible student to have a row.
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Draft payload must include at least one result row.';
  end if;

  select * into v_exam from public.exams where id = v_gb.exam_id and school_id = v_school;

  select coalesce(array_agg(e.student_id), array[]::uuid[])
  into v_eligible
  from public.exam_gradebook_eligible_student_ids(v_gb.exam_id, v_gb.class_id) e;

  -- Validate entire batch before writing.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_student := (v_row->>'student_id')::uuid;
    exception when others then
      raise exception 'Each row requires a valid student_id.';
    end;

    if v_student = any (v_seen) then
      raise exception 'Duplicate student rows in one payload are not allowed.';
    end if;
    v_seen := array_append(v_seen, v_student);

    if not (v_student = any (v_eligible)) then
      raise exception 'Student is not on the eligible roster for this gradebook.';
    end if;

    -- Block writing when another class already has a submitted/locked result for this exam.
    if exists (
      select 1
      from public.exam_assessment_results ar
      join public.exam_gradebooks og
        on og.id = ar.gradebook_id
      where ar.exam_id = v_gb.exam_id
        and ar.student_id = v_student
        and og.id <> v_gb.id
        and og.status in (
          'SUBMITTED'::public.gradebook_status,
          'LOCKED'::public.gradebook_status
        )
    ) then
      raise exception 'Student already has a submitted result for this exam in another class gradebook.';
    end if;

    begin
      v_status := upper(btrim(coalesce(v_row->>'entry_status', '')))::public.result_entry_status;
    exception when others then
      raise exception 'Invalid entry_status for student %.', v_student;
    end;

    if v_row ? 'marks_obtained'
       and v_row->>'marks_obtained' is not null
       and btrim(v_row->>'marks_obtained') <> '' then
      begin
        v_marks := (v_row->>'marks_obtained')::numeric(8,2);
      exception when others then
        raise exception 'Invalid marks for student %.', v_student;
      end;
      if v_marks::text in ('NaN', 'Infinity', '-Infinity') then
        raise exception 'Marks must be a finite number (student %).', v_student;
      end if;
    else
      v_marks := null;
    end if;

    if v_status = 'SCORED'::public.result_entry_status then
      if v_marks is null then
        raise exception 'Scored entries require a mark (student %).', v_student;
      end if;
      if v_marks < 0 then
        raise exception 'Marks cannot be negative (student %).', v_student;
      end if;
      if v_marks > v_exam.max_marks then
        raise exception 'Marks cannot exceed the exam maximum (student %).', v_student;
      end if;
    else
      if v_marks is not null then
        raise exception 'Absent/exempt/not assessed entries cannot include a mark (student %).', v_student;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  -- After payload validates: prune draft rows for students who left the eligible roster.
  -- Omitted eligible students remain (partial upsert). Ineligible-only prune.
  delete from public.exam_assessment_results ar
  where ar.gradebook_id = v_gb.id
    and not (ar.student_id = any (v_eligible));

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_student := (v_row->>'student_id')::uuid;
    v_status := upper(btrim(v_row->>'entry_status'))::public.result_entry_status;
    if v_row ? 'marks_obtained'
       and v_row->>'marks_obtained' is not null
       and btrim(v_row->>'marks_obtained') <> '' then
      v_marks := (v_row->>'marks_obtained')::numeric(8,2);
    else
      v_marks := null;
    end if;
    v_comment := nullif(btrim(coalesce(v_row->>'comment', '')), '');

    insert into public.exam_assessment_results (
      school_id, gradebook_id, exam_id, student_id,
      entry_status, marks_obtained, max_marks_snapshot, comment,
      row_revision, created_by, updated_by
    ) values (
      v_school, v_gb.id, v_gb.exam_id, v_student,
      v_status, v_marks, v_exam.max_marks, v_comment,
      v_gb.revision + 1, auth.uid(), auth.uid()
    )
    on conflict (gradebook_id, student_id) do update
      set entry_status = excluded.entry_status,
          marks_obtained = excluded.marks_obtained,
          max_marks_snapshot = excluded.max_marks_snapshot,
          comment = excluded.comment,
          row_revision = excluded.row_revision,
          updated_by = auth.uid(),
          updated_at = now();
  end loop;

  update public.exam_gradebooks
  set revision = revision + 1,
      last_saved_by = auth.uid(),
      last_saved_at = now(),
      updated_at = now()
  where id = v_gb.id
  returning * into v_gb;

  perform public.log_academic_event(
    'GRADEBOOK_DRAFT_SAVED',
    'exam_gradebook',
    v_gb.id,
    jsonb_build_object(
      'exam_id', v_gb.exam_id,
      'class_id', v_gb.class_id,
      'revision', v_gb.revision,
      'row_count', v_count
    )
  );

  return jsonb_build_object(
    'gradebook_id', v_gb.id,
    'revision', v_gb.revision,
    'saved_count', v_count,
    'status', v_gb.status
  );
end;
$$;

revoke all on function public.save_exam_gradebook_draft(uuid, integer, jsonb) from public;
grant execute on function public.save_exam_gradebook_draft(uuid, integer, jsonb) to authenticated;

create or replace function public.submit_exam_gradebook(
  p_gradebook_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_gb public.exam_gradebooks%rowtype;
  v_eligible uuid[];
  v_result_students uuid[];
  v_missing int;
  v_snapshot jsonb;
  v_pruned int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_gb
  from public.exam_gradebooks
  where id = p_gradebook_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Gradebook not found.';
  end if;

  if not public.can_enter_exam_gradebook(v_gb.exam_id, v_gb.class_id) then
    raise exception 'You are not authorized to submit this gradebook.';
  end if;

  if v_gb.status not in (
    'DRAFT'::public.gradebook_status,
    'REOPENED'::public.gradebook_status
  ) then
    raise exception 'Only draft or reopened gradebooks can be submitted.';
  end if;

  if v_gb.status = 'DRAFT'::public.gradebook_status then
    if not public.exam_allows_marks_entry(v_gb.exam_id) then
      raise exception 'Marks entry is not available for this exam.';
    end if;
  elsif not public.exam_allows_marks_entry(v_gb.exam_id)
        and not public.has_academic_capability('GRADEBOOK_REOPEN') then
    raise exception 'Marks entry window is closed. An authorised reopen is required to resubmit.';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_gb.revision then
    raise exception 'Gradebook was updated by someone else. Reload and try again. (revision conflict)';
  end if;

  select coalesce(array_agg(e.student_id), array[]::uuid[])
  into v_eligible
  from public.exam_gradebook_eligible_student_ids(v_gb.exam_id, v_gb.class_id) e;

  if coalesce(array_length(v_eligible, 1), 0) = 0 then
    raise exception 'There are no eligible students on the roster to submit.';
  end if;

  -- Prune draft results for students no longer eligible (withdrawn/transferred/excluded).
  -- Eligible students' marks are never deleted here. After SUBMITTED/LOCKED, this RPC cannot run.
  with deleted as (
    delete from public.exam_assessment_results ar
    where ar.gradebook_id = v_gb.id
      and not (ar.student_id = any (v_eligible))
    returning 1
  )
  select count(*)::int into v_pruned from deleted;

  select coalesce(array_agg(ar.student_id), array[]::uuid[])
  into v_result_students
  from public.exam_assessment_results ar
  where ar.gradebook_id = v_gb.id;

  select count(*)::int into v_missing
  from unnest(v_eligible) e(student_id)
  where not (e.student_id = any (v_result_students));

  if v_missing > 0 then
    raise exception
      'Incomplete gradebook: % eligible student(s) have no result. Partial submission is blocked.',
      v_missing;
  end if;

  -- One submitted/locked result per exam+student across class gradebooks.
  if exists (
    select 1
    from public.exam_assessment_results ar
    join public.exam_gradebooks og on og.id = ar.gradebook_id
    where ar.exam_id = v_gb.exam_id
      and ar.student_id = any (v_eligible)
      and og.id <> v_gb.id
      and og.status in (
        'SUBMITTED'::public.gradebook_status,
        'LOCKED'::public.gradebook_status
      )
  ) then
    raise exception 'One or more students already have a submitted result for this exam in another class gradebook.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e.student_id) order by e.student_id), '[]'::jsonb)
  into v_snapshot
  from unnest(v_eligible) e(student_id);

  update public.exam_gradebooks
  set status = 'SUBMITTED',
      revision = revision + 1,
      submitted_by = auth.uid(),
      submitted_at = now(),
      roster_snapshot = v_snapshot,
      last_saved_by = auth.uid(),
      last_saved_at = now(),
      updated_at = now()
  where id = v_gb.id
  returning * into v_gb;

  perform public.log_academic_event(
    'GRADEBOOK_SUBMITTED',
    'exam_gradebook',
    v_gb.id,
    jsonb_build_object(
      'exam_id', v_gb.exam_id,
      'class_id', v_gb.class_id,
      'revision', v_gb.revision,
      'roster_count', coalesce(array_length(v_eligible, 1), 0),
      'pruned_ineligible_count', v_pruned
    )
  );

  return jsonb_build_object(
    'gradebook_id', v_gb.id,
    'status', v_gb.status,
    'revision', v_gb.revision,
    'submitted_at', v_gb.submitted_at,
    'roster_count', coalesce(array_length(v_eligible, 1), 0),
    'pruned_ineligible_count', v_pruned
  );
end;
$$;

revoke all on function public.submit_exam_gradebook(uuid, integer) from public;
grant execute on function public.submit_exam_gradebook(uuid, integer) to authenticated;

create or replace function public.reopen_exam_gradebook(
  p_gradebook_id uuid,
  p_reason text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_gb public.exam_gradebooks%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_prev public.gradebook_status;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  perform public.require_academic_capability('GRADEBOOK_REOPEN');

  if v_reason is null then
    raise exception 'A reopening reason is required.';
  end if;

  select * into v_gb
  from public.exam_gradebooks
  where id = p_gradebook_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Gradebook not found.';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_gb.revision then
    raise exception 'Gradebook was updated by someone else. Reload and try again. (revision conflict)';
  end if;

  if v_gb.status is distinct from 'SUBMITTED'::public.gradebook_status then
    raise exception 'Only submitted gradebooks can be reopened. Locked gradebooks require a separate unlock policy (not available in Stage 1).';
  end if;

  v_prev := v_gb.status;

  update public.exam_gradebooks
  set status = 'REOPENED',
      revision = revision + 1,
      reopened_by = auth.uid(),
      reopened_at = now(),
      reopening_reason = v_reason,
      -- Preserve original submission metadata for history.
      updated_at = now()
  where id = v_gb.id
  returning * into v_gb;

  perform public.log_academic_event(
    'GRADEBOOK_REOPENED',
    'exam_gradebook',
    v_gb.id,
    jsonb_build_object(
      'exam_id', v_gb.exam_id,
      'class_id', v_gb.class_id,
      'previous_status', v_prev,
      'new_status', v_gb.status,
      'revision', v_gb.revision,
      'reason', v_reason,
      'submitted_at', v_gb.submitted_at,
      'submitted_by', v_gb.submitted_by
    )
  );

  return jsonb_build_object(
    'gradebook_id', v_gb.id,
    'status', v_gb.status,
    'revision', v_gb.revision,
    'reopened_at', v_gb.reopened_at
  );
end;
$$;

revoke all on function public.reopen_exam_gradebook(uuid, text, integer) from public;
grant execute on function public.reopen_exam_gradebook(uuid, text, integer) to authenticated;

create or replace function public.lock_exam_gradebook(
  p_gradebook_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_gb public.exam_gradebooks%rowtype;
  v_prev public.gradebook_status;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  perform public.require_academic_capability('GRADEBOOK_LOCK');

  select * into v_gb
  from public.exam_gradebooks
  where id = p_gradebook_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Gradebook not found.';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_gb.revision then
    raise exception 'Gradebook was updated by someone else. Reload and try again. (revision conflict)';
  end if;

  if v_gb.status is distinct from 'SUBMITTED'::public.gradebook_status then
    raise exception 'Only submitted gradebooks can be locked. Reopened gradebooks must be resubmitted first.';
  end if;

  -- Ensure submitted metadata exists.
  if v_gb.submitted_at is null then
    raise exception 'Cannot lock a gradebook that has never been submitted.';
  end if;

  v_prev := v_gb.status;

  update public.exam_gradebooks
  set status = 'LOCKED',
      revision = revision + 1,
      locked_by = auth.uid(),
      locked_at = now(),
      updated_at = now()
  where id = v_gb.id
  returning * into v_gb;

  perform public.log_academic_event(
    'GRADEBOOK_LOCKED',
    'exam_gradebook',
    v_gb.id,
    jsonb_build_object(
      'exam_id', v_gb.exam_id,
      'class_id', v_gb.class_id,
      'previous_status', v_prev,
      'revision', v_gb.revision
    )
  );

  return jsonb_build_object(
    'gradebook_id', v_gb.id,
    'status', v_gb.status,
    'revision', v_gb.revision,
    'locked_at', v_gb.locked_at
  );
end;
$$;

revoke all on function public.lock_exam_gradebook(uuid, integer) from public;
grant execute on function public.lock_exam_gradebook(uuid, integer) to authenticated;
