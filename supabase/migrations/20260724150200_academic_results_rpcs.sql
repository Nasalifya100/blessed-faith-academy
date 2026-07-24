-- ===========================================================================
-- Phase 2D.1 — Results engine RPCs
-- Snapshots may only be written after source-mark validation + scope checks.
-- Amended in pre-commit review: advisory lock, FK/school validation,
-- mark matching against SUBMITTED/LOCKED gradebooks, settings write gate.
-- ===========================================================================

create or replace function public.ensure_academic_results_settings()
returns public.academic_results_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_row public.academic_results_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;
  if not (
    public.has_academic_capability('RESULTS_VIEW')
    or public.has_academic_capability('RESULTS_VIEW_ALL')
    or public.has_academic_capability('RESULTS_RECALCULATE')
  ) then
    raise exception 'You are not authorized to view results settings.';
  end if;

  select * into v_row
  from public.academic_results_settings
  where school_id = v_school;

  if found then
    return v_row;
  end if;

  -- Only recalculate/manage roles may create the defaults row.
  if not public.has_academic_capability('RESULTS_RECALCULATE') then
    raise exception 'Results settings have not been initialized.';
  end if;

  insert into public.academic_results_settings (school_id, updated_by)
  values (v_school, auth.uid())
  on conflict (school_id) do nothing;

  select * into v_row
  from public.academic_results_settings
  where school_id = v_school;

  return v_row;
end;
$$;

revoke all on function public.ensure_academic_results_settings() from public;
grant execute on function public.ensure_academic_results_settings() to authenticated;

create or replace function public.replace_class_term_result_snapshots(
  p_academic_year_id uuid,
  p_term_id uuid,
  p_class_id uuid,
  p_batch_id uuid,
  p_engine_version text,
  p_source_fingerprint text,
  p_exam_rows jsonb default '[]'::jsonb,
  p_subject_rows jsonb default '[]'::jsonb,
  p_term_rows jsonb default '[]'::jsonb,
  p_statistic_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_engine text := nullif(btrim(coalesce(p_engine_version, '')), '');
  v_fingerprint text := nullif(btrim(coalesce(p_source_fingerprint, '')), '');
  v_class public.classes%rowtype;
  v_term public.terms%rowtype;
  v_row jsonb;
  v_gradebook public.exam_gradebooks%rowtype;
  v_exam public.exams%rowtype;
  v_period public.exam_periods%rowtype;
  v_result public.exam_assessment_results%rowtype;
  v_marks numeric;
  v_max numeric;
  v_status public.result_entry_status;
  v_expected_pct numeric;
  v_client_pct numeric;
  v_scheme_id uuid;
  v_places int;
  v_scheme_min numeric;
  v_scheme_max numeric;
  v_band_code text;
  v_exam_count int := 0;
  v_subject_count int := 0;
  v_term_count int := 0;
  v_stat_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;
  if not public.has_academic_capability('RESULTS_RECALCULATE') then
    raise exception 'You are not authorized to recalculate results.';
  end if;
  if p_academic_year_id is null or p_term_id is null or p_class_id is null then
    raise exception 'Academic year, term, and class are required.';
  end if;
  if v_engine is null then
    raise exception 'Engine version is required.';
  end if;
  if v_fingerprint is null then
    raise exception 'Source fingerprint is required.';
  end if;

  -- Serialize concurrent recalculation for the same class×term.
  perform pg_advisory_xact_lock(
    ('x' || substr(md5(
      v_school::text || ':' || p_academic_year_id::text || ':' ||
      p_term_id::text || ':' || p_class_id::text
    ), 1, 16))::bit(64)::bigint
  );

  if not exists (
    select 1 from public.academic_years
    where id = p_academic_year_id and school_id = v_school
  ) then
    raise exception 'Academic year not found.';
  end if;

  select * into v_term
  from public.terms
  where id = p_term_id and academic_year_id = p_academic_year_id;

  if not found then
    raise exception 'Term not found for academic year.';
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id and school_id = v_school;

  if not found then
    raise exception 'Class not found.';
  end if;

  if v_class.academic_year_id is distinct from p_academic_year_id then
    raise exception 'Class does not belong to the requested academic year.';
  end if;

  -- Validate every exam row against authoritative SUBMITTED/LOCKED marks.
  for v_row in
    select value from jsonb_array_elements(coalesce(p_exam_rows, '[]'::jsonb))
  loop
    v_exam_count := v_exam_count + 1;

    select * into v_gradebook
    from public.exam_gradebooks
    where id = (v_row->>'gradebook_id')::uuid
      and school_id = v_school
      and class_id = p_class_id;

    if not found then
      raise exception 'Gradebook not found for class scope.';
    end if;

    if v_gradebook.status not in (
      'SUBMITTED'::public.gradebook_status,
      'LOCKED'::public.gradebook_status
    ) then
      raise exception 'Only SUBMITTED or LOCKED gradebooks may feed results.';
    end if;

    if v_gradebook.revision is distinct from (v_row->>'gradebook_revision')::int then
      raise exception 'Gradebook revision mismatch; recalculate from current source.';
    end if;

    select * into v_exam
    from public.exams
    where id = v_gradebook.exam_id and school_id = v_school and is_active;

    if not found then
      raise exception 'Exam not found or inactive.';
    end if;

    if v_exam.id is distinct from (v_row->>'exam_id')::uuid then
      raise exception 'Exam id does not match gradebook.';
    end if;

    if v_exam.subject_id is distinct from (v_row->>'subject_id')::uuid then
      raise exception 'Subject id does not match exam.';
    end if;

    select * into v_period
    from public.exam_periods
    where id = v_exam.exam_period_id and school_id = v_school;

    if not found
       or v_period.academic_year_id is distinct from p_academic_year_id
       or v_period.term_id is distinct from p_term_id then
      raise exception 'Exam period does not match requested year/term.';
    end if;

    select * into v_result
    from public.exam_assessment_results
    where gradebook_id = v_gradebook.id
      and student_id = (v_row->>'student_id')::uuid
      and school_id = v_school;

    if not found then
      raise exception 'Source mark row not found.';
    end if;

    v_status := v_result.entry_status;
    v_marks := v_result.marks_obtained;
    v_max := v_result.max_marks_snapshot;

    if v_status::text is distinct from (v_row->>'entry_status') then
      raise exception 'Entry status does not match source mark.';
    end if;

    if v_max is distinct from (v_row->>'max_marks')::numeric then
      raise exception 'Max marks do not match source mark.';
    end if;

    if v_marks is distinct from nullif(v_row->>'marks_obtained', '')::numeric then
      raise exception 'Marks obtained do not match source mark.';
    end if;

    -- School-scope optional FKs on exam rows.
    v_scheme_id := nullif(v_row->>'grading_scheme_id', '')::uuid;
    if v_scheme_id is not null and not exists (
      select 1 from public.grading_schemes
      where id = v_scheme_id and school_id = v_school
    ) then
      raise exception 'Grading scheme is not in this school.';
    end if;

    if nullif(v_row->>'assessment_type_id', '') is not null
       and not exists (
         select 1 from public.assessment_types
         where id = (v_row->>'assessment_type_id')::uuid
           and school_id = v_school
       ) then
      raise exception 'Assessment type is not in this school.';
    end if;

    -- Recompute percentage from authoritative marks (scheme 0–100 scale).
    -- Client percentage must match; non-scored rows must not invent a percentage.
    v_client_pct := nullif(v_row->>'percentage', '')::numeric;
    v_expected_pct := null;

    if v_status = 'SCORED'::public.result_entry_status then
      if v_marks is null or v_max is null or v_max <= 0 then
        raise exception 'SCORED rows require valid marks and max marks.';
      end if;

      v_places := coalesce(
        nullif(v_row->'grading_scheme_snapshot'->>'decimal_places', '')::int,
        2
      );
      v_scheme_min := coalesce(
        nullif(v_row->'grading_scheme_snapshot'->>'min_score', '')::numeric,
        0
      );
      v_scheme_max := coalesce(
        nullif(v_row->'grading_scheme_snapshot'->>'max_score', '')::numeric,
        100
      );
      if v_scheme_max <= v_scheme_min then
        raise exception 'Invalid grading scheme score range in snapshot.';
      end if;

      v_expected_pct := round(
        v_scheme_min
          + (v_marks / v_max) * (v_scheme_max - v_scheme_min),
        greatest(0, least(6, v_places))
      );
      -- Clamp to scheme range (matches TypeScript clampNumber).
      if v_expected_pct < v_scheme_min then
        v_expected_pct := v_scheme_min;
      elsif v_expected_pct > v_scheme_max then
        v_expected_pct := v_scheme_max;
      end if;

      if v_client_pct is distinct from v_expected_pct then
        raise exception 'Percentage does not match source marks.';
      end if;

      -- Grade code must match an inclusive band for the validated percentage.
      if nullif(v_row->>'grade_code', '') is not null then
        select b.grade_code into v_band_code
        from public.grading_scheme_bands b
        where b.grading_scheme_id = v_scheme_id
          and v_expected_pct >= b.minimum_score
          and v_expected_pct <= b.maximum_score
        order by b.minimum_score desc
        limit 1;

        if v_band_code is null
           or v_band_code is distinct from (v_row->>'grade_code') then
          raise exception 'Grade code does not match grading scheme bands.';
        end if;
      end if;
    elsif v_status = 'ABSENT'::public.result_entry_status then
      -- Optional school rule treat_absent_as_zero: percentage may equal scheme min.
      v_scheme_min := coalesce(
        nullif(v_row->'grading_scheme_snapshot'->>'min_score', '')::numeric,
        0
      );
      if v_client_pct is not null and v_client_pct is distinct from v_scheme_min then
        raise exception 'ABSENT percentage must be null or the scheme minimum.';
      end if;
      if v_client_pct is not null
         and nullif(v_row->>'grade_code', '') is not null
         and v_scheme_id is not null then
        select b.grade_code into v_band_code
        from public.grading_scheme_bands b
        where b.grading_scheme_id = v_scheme_id
          and v_client_pct >= b.minimum_score
          and v_client_pct <= b.maximum_score
        order by b.minimum_score desc
        limit 1;
        if v_band_code is null
           or v_band_code is distinct from (v_row->>'grade_code') then
          raise exception 'ABSENT grade code does not match scheme bands.';
        end if;
      end if;
    else
      -- EXEMPT / NOT_ASSESSED never invent numeric outcomes.
      if v_client_pct is not null then
        raise exception 'Non-scored rows must not carry a percentage.';
      end if;
      if nullif(v_row->>'grade_code', '') is not null
         or (
           v_row ? 'is_pass'
           and jsonb_typeof(v_row->'is_pass') = 'boolean'
         ) then
        raise exception 'Non-scored rows must not carry grade outcomes.';
      end if;
    end if;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_subject_rows, '[]'::jsonb))
  loop
    v_subject_count := v_subject_count + 1;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(p_exam_rows, '[]'::jsonb)) e
      where (e.value->>'student_id') = (v_row->>'student_id')
        and (e.value->>'subject_id') = (v_row->>'subject_id')
    ) then
      raise exception 'Subject snapshot is not backed by validated exam rows.';
    end if;
    if (v_row->>'subject_position') is not null
       and (v_row->>'subject_position')::numeric < 1 then
      raise exception 'Subject position must be null or >= 1.';
    end if;
    if coalesce((v_row->>'tied_count')::int, 0) < 0 then
      raise exception 'Tied count cannot be negative.';
    end if;
    if (v_row->>'weighted_percentage') is not null then
      if (v_row->>'weighted_percentage')::numeric < 0
         or (v_row->>'weighted_percentage')::numeric > 100 then
        raise exception 'Weighted percentage out of range.';
      end if;
    end if;
    if nullif(v_row->>'weight_scheme_id', '') is not null
       and not exists (
         select 1 from public.assessment_weight_schemes
         where id = (v_row->>'weight_scheme_id')::uuid
           and school_id = v_school
       ) then
      raise exception 'Weight scheme is not in this school.';
    end if;
    if nullif(v_row->>'grading_scheme_id', '') is not null
       and not exists (
         select 1 from public.grading_schemes
         where id = (v_row->>'grading_scheme_id')::uuid
           and school_id = v_school
       ) then
      raise exception 'Grading scheme is not in this school.';
    end if;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_term_rows, '[]'::jsonb))
  loop
    v_term_count := v_term_count + 1;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(p_exam_rows, '[]'::jsonb)) e
      where (e.value->>'student_id') = (v_row->>'student_id')
    ) then
      raise exception 'Term snapshot is not backed by validated exam rows.';
    end if;
    if (v_row->>'overall_position') is not null
       and (v_row->>'overall_position')::numeric < 1 then
      raise exception 'Overall position must be null or >= 1.';
    end if;
    if (v_row->>'average_percentage') is not null then
      if (v_row->>'average_percentage')::numeric < 0
         or (v_row->>'average_percentage')::numeric > 100 then
        raise exception 'Average percentage out of range.';
      end if;
    end if;
    if nullif(v_row->>'promotion_policy_id', '') is not null
       and not exists (
         select 1 from public.promotion_policies
         where id = (v_row->>'promotion_policy_id')::uuid
           and school_id = v_school
       ) then
      raise exception 'Promotion policy is not in this school.';
    end if;
    if nullif(v_row->>'grading_scheme_id', '') is not null
       and not exists (
         select 1 from public.grading_schemes
         where id = (v_row->>'grading_scheme_id')::uuid
           and school_id = v_school
       ) then
      raise exception 'Grading scheme is not in this school.';
    end if;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_statistic_rows, '[]'::jsonb))
  loop
    v_stat_count := v_stat_count + 1;
    if (v_row->>'scope') = 'CLASS_TERM'
       and nullif(v_row->>'subject_id', '') is not null then
      raise exception 'CLASS_TERM statistics must not include subject_id.';
    end if;
    if (v_row->>'scope') = 'CLASS_SUBJECT_TERM'
       and nullif(v_row->>'subject_id', '') is null then
      raise exception 'CLASS_SUBJECT_TERM statistics require subject_id.';
    end if;
  end loop;

  delete from public.student_exam_result_snapshots
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and term_id = p_term_id
    and class_id = p_class_id;

  delete from public.student_subject_result_snapshots
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and term_id = p_term_id
    and class_id = p_class_id;

  delete from public.student_term_result_snapshots
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and term_id = p_term_id
    and class_id = p_class_id;

  delete from public.result_statistic_snapshots
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and term_id = p_term_id
    and class_id = p_class_id;

  insert into public.student_exam_result_snapshots (
    school_id, academic_year_id, term_id, class_id, subject_id, exam_id,
    gradebook_id, gradebook_revision, assessment_type_id, student_id, entry_status,
    marks_obtained, max_marks, percentage, grade_code, grade_label, grade_point,
    is_pass, remark, grading_scheme_id, grading_scheme_version,
    grading_scheme_snapshot, engine_version, source_fingerprint,
    computation_batch_id, computed_by
  )
  select
    v_school,
    p_academic_year_id,
    p_term_id,
    p_class_id,
    (row->>'subject_id')::uuid,
    (row->>'exam_id')::uuid,
    (row->>'gradebook_id')::uuid,
    (row->>'gradebook_revision')::int,
    nullif(row->>'assessment_type_id', '')::uuid,
    (row->>'student_id')::uuid,
    (row->>'entry_status')::public.result_entry_status,
    nullif(row->>'marks_obtained', '')::numeric,
    (row->>'max_marks')::numeric,
    nullif(row->>'percentage', '')::numeric,
    nullif(row->>'grade_code', ''),
    nullif(row->>'grade_label', ''),
    nullif(row->>'grade_point', '')::numeric,
    case
      when row ? 'is_pass' and jsonb_typeof(row->'is_pass') = 'boolean'
        then (row->>'is_pass')::boolean
      else null
    end,
    nullif(row->>'remark', ''),
    nullif(row->>'grading_scheme_id', '')::uuid,
    nullif(row->>'grading_scheme_version', '')::int,
    coalesce(row->'grading_scheme_snapshot', '{}'::jsonb),
    v_engine,
    v_fingerprint,
    v_batch,
    auth.uid()
  from jsonb_array_elements(coalesce(p_exam_rows, '[]'::jsonb)) as row;

  insert into public.student_subject_result_snapshots (
    school_id, academic_year_id, term_id, class_id, subject_id, student_id,
    weighted_percentage, grade_code, grade_label, grade_point, is_pass, remark,
    subject_position, tied_count, components, weight_scheme_id, weight_scheme_snapshot,
    grading_scheme_id, grading_scheme_version, grading_scheme_snapshot,
    engine_version, source_fingerprint, computation_batch_id, computed_by
  )
  select
    v_school,
    p_academic_year_id,
    p_term_id,
    p_class_id,
    (row->>'subject_id')::uuid,
    (row->>'student_id')::uuid,
    nullif(row->>'weighted_percentage', '')::numeric,
    nullif(row->>'grade_code', ''),
    nullif(row->>'grade_label', ''),
    nullif(row->>'grade_point', '')::numeric,
    case
      when row ? 'is_pass' and jsonb_typeof(row->'is_pass') = 'boolean'
        then (row->>'is_pass')::boolean
      else null
    end,
    nullif(row->>'remark', ''),
    nullif(row->>'subject_position', '')::numeric,
    coalesce(nullif(row->>'tied_count', '')::int, 0),
    coalesce(row->'components', '[]'::jsonb),
    nullif(row->>'weight_scheme_id', '')::uuid,
    coalesce(row->'weight_scheme_snapshot', '[]'::jsonb),
    nullif(row->>'grading_scheme_id', '')::uuid,
    nullif(row->>'grading_scheme_version', '')::int,
    coalesce(row->'grading_scheme_snapshot', '{}'::jsonb),
    v_engine,
    v_fingerprint,
    v_batch,
    auth.uid()
  from jsonb_array_elements(coalesce(p_subject_rows, '[]'::jsonb)) as row;

  insert into public.student_term_result_snapshots (
    school_id, academic_year_id, term_id, class_id, student_id,
    subject_count, scored_subject_count, passed_subject_count, failed_subject_count,
    average_percentage, grade_code, grade_label, grade_point, is_pass, remark,
    overall_position, tied_count, promotion_outcome, promotion_reason,
    grading_scheme_id, grading_scheme_version, grading_scheme_snapshot,
    promotion_policy_id, promotion_policy_snapshot,
    engine_version, source_fingerprint, is_stale,
    computation_batch_id, computed_by
  )
  select
    v_school,
    p_academic_year_id,
    p_term_id,
    p_class_id,
    (row->>'student_id')::uuid,
    coalesce(nullif(row->>'subject_count', '')::int, 0),
    coalesce(nullif(row->>'scored_subject_count', '')::int, 0),
    coalesce(nullif(row->>'passed_subject_count', '')::int, 0),
    coalesce(nullif(row->>'failed_subject_count', '')::int, 0),
    nullif(row->>'average_percentage', '')::numeric,
    nullif(row->>'grade_code', ''),
    nullif(row->>'grade_label', ''),
    nullif(row->>'grade_point', '')::numeric,
    case
      when row ? 'is_pass' and jsonb_typeof(row->'is_pass') = 'boolean'
        then (row->>'is_pass')::boolean
      else null
    end,
    nullif(row->>'remark', ''),
    nullif(row->>'overall_position', '')::numeric,
    coalesce(nullif(row->>'tied_count', '')::int, 0),
    coalesce(
      nullif(row->>'promotion_outcome', '')::public.promotion_outcome,
      'UNDECIDED'::public.promotion_outcome
    ),
    nullif(row->>'promotion_reason', ''),
    nullif(row->>'grading_scheme_id', '')::uuid,
    nullif(row->>'grading_scheme_version', '')::int,
    coalesce(row->'grading_scheme_snapshot', '{}'::jsonb),
    nullif(row->>'promotion_policy_id', '')::uuid,
    coalesce(row->'promotion_policy_snapshot', '[]'::jsonb),
    v_engine,
    v_fingerprint,
    false,
    v_batch,
    auth.uid()
  from jsonb_array_elements(coalesce(p_term_rows, '[]'::jsonb)) as row;

  insert into public.result_statistic_snapshots (
    school_id, academic_year_id, term_id, class_id, subject_id, scope,
    stats, engine_version, source_fingerprint, computation_batch_id, computed_by
  )
  select
    v_school,
    p_academic_year_id,
    p_term_id,
    p_class_id,
    nullif(row->>'subject_id', '')::uuid,
    (row->>'scope')::public.result_statistic_scope,
    coalesce(row->'stats', '{}'::jsonb),
    v_engine,
    v_fingerprint,
    v_batch,
    auth.uid()
  from jsonb_array_elements(coalesce(p_statistic_rows, '[]'::jsonb)) as row;

  perform public.log_academic_event(
    'RESULTS_CLASS_TERM_RECALCULATED',
    'class_term_results',
    p_class_id,
    jsonb_build_object(
      'academic_year_id', p_academic_year_id,
      'term_id', p_term_id,
      'class_id', p_class_id,
      'batch_id', v_batch,
      'engine_version', v_engine,
      'source_fingerprint', v_fingerprint,
      'exam_rows', v_exam_count,
      'subject_rows', v_subject_count,
      'term_rows', v_term_count,
      'statistic_rows', v_stat_count
    )
  );

  return jsonb_build_object(
    'batch_id', v_batch,
    'exam_count', v_exam_count,
    'subject_count', v_subject_count,
    'term_count', v_term_count,
    'statistic_count', v_stat_count,
    'engine_version', v_engine,
    'source_fingerprint', v_fingerprint
  );
end;
$$;

revoke all on function public.replace_class_term_result_snapshots(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.replace_class_term_result_snapshots(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
