-- ===========================================================================
-- Phase 2D.2 — Report card RPCs (SECURITY DEFINER, capability-gated)
-- Generation validates Phase 2D.1 term snapshots; approval freezes render payload.
-- ===========================================================================

create or replace function public.ensure_report_card_settings()
returns public.report_card_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_row public.report_card_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;
  if not (
    public.has_academic_capability('REPORT_CARDS_VIEW')
    or public.has_academic_capability('REPORT_CARDS_VIEW_ALL')
    or public.has_academic_capability('REPORT_CARD_SETTINGS_MANAGE')
  ) then
    raise exception 'You are not authorized to view report-card settings.';
  end if;

  select * into v_row
  from public.report_card_settings
  where school_id = v_school;

  if found then
    return v_row;
  end if;

  if not (
    public.has_academic_capability('REPORT_CARD_SETTINGS_MANAGE')
    or public.has_academic_capability('REPORT_CARDS_APPROVE')
  ) then
    raise exception 'Report-card settings have not been initialized.';
  end if;

  insert into public.report_card_settings (school_id, updated_by)
  values (v_school, auth.uid())
  on conflict (school_id) do nothing;

  select * into v_row
  from public.report_card_settings
  where school_id = v_school;

  perform public.log_academic_event(
    'REPORT_CARD_SETTINGS_ENSURED',
    'report_card_settings',
    v_school,
    jsonb_build_object('school_id', v_school)
  );

  return v_row;
end;
$$;

revoke all on function public.ensure_report_card_settings() from public;
grant execute on function public.ensure_report_card_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to authenticated / anon)
-- ---------------------------------------------------------------------------
create or replace function public.report_card_sanitize_remark(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := coalesce(p_value, '');
begin
  -- Strip tags and C0 controls; plain text only.
  v := regexp_replace(v, '<[^>]*>', '', 'g');
  v := regexp_replace(v, E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', '', 'g');
  v := btrim(v);
  if v = '' then
    return null;
  end if;
  return left(v, 2000);
end;
$$;

revoke all on function public.report_card_sanitize_remark(text) from public, anon, authenticated;

create or replace function public.report_card_assert_results_current(
  p_school_id uuid,
  p_academic_year_id uuid,
  p_term_id uuid,
  p_class_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam record;
  v_live public.exam_gradebooks%rowtype;
begin
  for v_exam in
    select distinct gradebook_id, gradebook_revision
    from public.student_exam_result_snapshots
    where school_id = p_school_id
      and academic_year_id = p_academic_year_id
      and term_id = p_term_id
      and class_id = p_class_id
      and gradebook_id is not null
  loop
    select * into v_live
    from public.exam_gradebooks
    where id = v_exam.gradebook_id
      and school_id = p_school_id;

    if not found
       or v_live.status not in (
         'SUBMITTED'::public.gradebook_status,
         'LOCKED'::public.gradebook_status
       )
       or v_live.revision is distinct from v_exam.gradebook_revision then
      raise exception
        'Source gradebooks changed or were reopened. Recalculate results before continuing.';
    end if;
  end loop;
end;
$$;

revoke all on function public.report_card_assert_results_current(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.report_card_build_attendance_snapshot(
  p_school_id uuid,
  p_student_id uuid,
  p_class_id uuid,
  p_term_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_present int := 0;
  v_absent int := 0;
  v_late int := 0;
  v_excused int := 0;
  v_total int := 0;
begin
  select start_date, end_date into v_start, v_end
  from public.terms
  where id = p_term_id and school_id = p_school_id;

  if v_start is null or v_end is null then
    return jsonb_build_object(
      'available', false,
      'term_start', v_start,
      'term_end', v_end,
      'present', 0,
      'absent', 0,
      'late', 0,
      'excused', 0,
      'total', 0,
      'percentage', null,
      'note', 'Term dates are not configured.'
    );
  end if;

  select
    count(*) filter (where status = 'present'::public.attendance_status),
    count(*) filter (where status = 'absent'::public.attendance_status),
    count(*) filter (where status = 'late'::public.attendance_status),
    count(*) filter (where status = 'excused'::public.attendance_status),
    count(*)
  into v_present, v_absent, v_late, v_excused, v_total
  from public.attendance_records
  where school_id = p_school_id
    and student_id = p_student_id
    and class_id = p_class_id
    and attendance_date >= v_start
    and attendance_date <= v_end;

  if v_total = 0 then
    return jsonb_build_object(
      'available', false,
      'term_start', v_start,
      'term_end', v_end,
      'present', 0,
      'absent', 0,
      'late', 0,
      'excused', 0,
      'total', 0,
      'percentage', null,
      'note', 'No attendance registers recorded for this term.'
    );
  end if;

  return jsonb_build_object(
    'available', true,
    'term_start', v_start,
    'term_end', v_end,
    'present', v_present,
    'absent', v_absent,
    'late', v_late,
    'excused', v_excused,
    'total', v_total,
    'percentage', round(((v_present + v_late)::numeric / v_total::numeric) * 100, 2),
    'note', null
  );
end;
$$;

revoke all on function public.report_card_build_attendance_snapshot(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Generate / refresh a DRAFT from a validated Phase 2D.1 term snapshot
-- ---------------------------------------------------------------------------
create or replace function public.generate_or_refresh_report_card_draft(
  p_academic_year_id uuid,
  p_term_id uuid,
  p_class_id uuid,
  p_student_id uuid,
  p_source_fingerprint text,
  p_engine_version text,
  p_computation_batch_id uuid,
  p_term_result_snapshot_id uuid,
  p_attendance_snapshot jsonb default '{}'::jsonb,
  p_settings_snapshot jsonb default '{}'::jsonb
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_term_snap public.student_term_result_snapshots%rowtype;
  v_card public.student_report_cards%rowtype;
  v_fingerprint text := nullif(btrim(coalesce(p_source_fingerprint, '')), '');
  v_engine text := nullif(btrim(coalesce(p_engine_version, '')), '');
  v_attendance jsonb;
  v_settings jsonb;
  v_settings_row public.report_card_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;
  if not (
    public.has_academic_capability('REPORT_CARDS_VIEW_ALL')
    or public.has_academic_capability('REPORT_CARDS_APPROVE')
    or (
      public.has_academic_capability('REPORT_CARDS_VIEW')
      and public.can_view_class_results(p_class_id, p_term_id)
    )
  ) then
    raise exception 'You are not authorized to generate report cards.';
  end if;
  if v_fingerprint is null or v_engine is null or p_computation_batch_id is null then
    raise exception 'Source fingerprint, engine version, and batch are required.';
  end if;

  -- Client-supplied attendance/settings args are ignored (signature kept for PostgREST).
  -- Authoritative values are rebuilt below from attendance_records + report_card_settings.

  perform pg_advisory_xact_lock(
    ('x' || substr(md5(
      v_school::text || ':rc:' || p_academic_year_id::text || ':' ||
      p_term_id::text || ':' || p_class_id::text || ':' || p_student_id::text
    ), 1, 16))::bit(64)::bigint
  );

  select * into v_term_snap
  from public.student_term_result_snapshots
  where id = p_term_result_snapshot_id
    and school_id = v_school
    and academic_year_id = p_academic_year_id
    and term_id = p_term_id
    and class_id = p_class_id
    and student_id = p_student_id;

  if not found then
    raise exception 'Authoritative term result snapshot not found.';
  end if;

  if v_term_snap.source_fingerprint is distinct from v_fingerprint then
    raise exception 'Result fingerprint does not match the term snapshot.';
  end if;
  if v_term_snap.engine_version is distinct from v_engine then
    raise exception 'Engine version does not match the term snapshot.';
  end if;
  if v_term_snap.computation_batch_id is distinct from p_computation_batch_id then
    raise exception 'Computation batch does not match the term snapshot.';
  end if;
  if v_term_snap.is_stale then
    raise exception 'Results are marked stale; recalculate before generating report cards.';
  end if;

  perform public.report_card_assert_results_current(
    v_school, p_academic_year_id, p_term_id, p_class_id
  );

  v_attendance := public.report_card_build_attendance_snapshot(
    v_school, p_student_id, p_class_id, p_term_id
  );

  select * into v_settings_row
  from public.report_card_settings
  where school_id = v_school;
  if not found then
    if public.has_academic_capability('REPORT_CARD_SETTINGS_MANAGE')
       or public.has_academic_capability('REPORT_CARDS_APPROVE') then
      perform public.ensure_report_card_settings();
      select * into v_settings_row
      from public.report_card_settings
      where school_id = v_school;
    end if;
  end if;

  if v_settings_row.school_id is not null then
    v_settings := to_jsonb(v_settings_row) - 'school_id' - 'updated_by' - 'created_at' - 'updated_at';
  else
    v_settings := jsonb_build_object(
      'title', 'Term Report Card',
      'show_school_logo', true,
      'show_admission_number', true,
      'show_class_position', true,
      'show_subject_position', false,
      'show_grade_points', true,
      'show_promotion_recommendation', true,
      'show_attendance', true,
      'show_teacher_remark', true,
      'show_headteacher_remark', true,
      'show_grading_key', true,
      'show_generated_timestamp', true,
      'require_teacher_remark_for_review', false,
      'require_headteacher_remark_for_approve', true,
      'footer_text', null,
      'ranking_disabled_message', 'Class ranking is not published for this term.',
      'template_version', '2d.2.1'
    );
  end if;

  select * into v_card
  from public.student_report_cards
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and term_id = p_term_id
    and class_id = p_class_id
    and student_id = p_student_id
  for update;

  if found then
    if v_card.status in (
      'PUBLISHED'::public.report_card_status,
      'APPROVED'::public.report_card_status
    ) then
      raise exception 'Cannot regenerate an approved or published report card. Unpublish or void first.';
    end if;
    if v_card.status = 'VOIDED'::public.report_card_status then
      raise exception 'Cannot regenerate a voided report card.';
    end if;

    update public.student_report_cards
    set
      status = 'DRAFT'::public.report_card_status,
      revision = revision + 1,
      term_result_snapshot_id = v_term_snap.id,
      source_fingerprint = v_fingerprint,
      engine_version = v_engine,
      computation_batch_id = p_computation_batch_id,
      source_is_outdated = false,
      attendance_snapshot = v_attendance,
      settings_snapshot = v_settings,
      render_payload = null,
      render_payload_checksum = null,
      reviewed_by = null,
      reviewed_at = null,
      approved_by = null,
      approved_at = null,
      generated_at = now(),
      generated_by = auth.uid()
    where id = v_card.id
    returning * into v_card;
  else
    insert into public.student_report_cards (
      school_id, academic_year_id, term_id, class_id, student_id,
      status, term_result_snapshot_id, source_fingerprint, engine_version,
      computation_batch_id, attendance_snapshot, settings_snapshot,
      generated_by
    ) values (
      v_school, p_academic_year_id, p_term_id, p_class_id, p_student_id,
      'DRAFT'::public.report_card_status, v_term_snap.id, v_fingerprint, v_engine,
      p_computation_batch_id, v_attendance, v_settings, auth.uid()
    )
    returning * into v_card;
  end if;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status, metadata, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_DRAFT_GENERATED',
    null, 'DRAFT'::public.report_card_status,
    jsonb_build_object(
      'source_fingerprint', v_fingerprint,
      'engine_version', v_engine,
      'computation_batch_id', p_computation_batch_id
    ),
    auth.uid()
  );

  perform public.log_academic_event(
    'REPORT_CARD_DRAFT_GENERATED',
    'student_report_card',
    v_card.id,
    jsonb_build_object(
      'academic_year_id', p_academic_year_id,
      'term_id', p_term_id,
      'class_id', p_class_id,
      'student_id', p_student_id,
      'source_fingerprint', v_fingerprint
    )
  );

  return v_card;
end;
$$;

revoke all on function public.generate_or_refresh_report_card_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb, jsonb
) from public;
grant execute on function public.generate_or_refresh_report_card_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- Save remarks (optimistic concurrency)
-- ---------------------------------------------------------------------------
create or replace function public.save_report_card_remarks(
  p_report_card_id uuid,
  p_expected_revision int,
  p_teacher_remark text default null,
  p_headteacher_remark text default null,
  p_update_teacher boolean default false,
  p_update_headteacher boolean default false
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
  v_teacher text;
  v_head text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.has_academic_capability('REPORT_CARDS_EDIT_REMARKS') then
    raise exception 'You are not authorized to edit remarks.';
  end if;

  v_teacher := public.report_card_sanitize_remark(p_teacher_remark);
  v_head := public.report_card_sanitize_remark(p_headteacher_remark);

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Report card not found.';
  end if;
  if not public.can_view_report_card(v_card.id) then
    raise exception 'You are not authorized to edit this report card.';
  end if;
  if v_card.revision is distinct from p_expected_revision then
    raise exception 'Revision conflict; refresh and try again.';
  end if;
  if v_card.status in (
    'APPROVED'::public.report_card_status,
    'PUBLISHED'::public.report_card_status,
    'VOIDED'::public.report_card_status
  ) then
    raise exception 'Remarks cannot be edited in the current status.';
  end if;

  if p_update_teacher then
    v_card.teacher_remark := v_teacher;
    v_card.teacher_remark_by := case when v_teacher is null then null else auth.uid() end;
    v_card.teacher_remark_at := case when v_teacher is null then null else now() end;
  end if;

  if p_update_headteacher then
    if not (
      public.has_academic_capability('REPORT_CARDS_APPROVE')
      or public.has_academic_capability('REPORT_CARDS_VIEW_ALL')
    ) then
      raise exception 'Only head/admin may edit headteacher remarks.';
    end if;
    v_card.headteacher_remark := v_head;
    v_card.headteacher_remark_by := case when v_head is null then null else auth.uid() end;
    v_card.headteacher_remark_at := case when v_head is null then null else now() end;
  end if;

  update public.student_report_cards
  set
    teacher_remark = v_card.teacher_remark,
    teacher_remark_by = v_card.teacher_remark_by,
    teacher_remark_at = v_card.teacher_remark_at,
    headteacher_remark = v_card.headteacher_remark,
    headteacher_remark_by = v_card.headteacher_remark_by,
    headteacher_remark_at = v_card.headteacher_remark_at,
    revision = revision + 1
  where id = v_card.id
  returning * into v_card;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status, metadata, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_REMARKS_SAVED',
    v_card.status, v_card.status,
    jsonb_build_object(
      'updated_teacher', p_update_teacher,
      'updated_headteacher', p_update_headteacher
    ),
    auth.uid()
  );

  return v_card;
end;
$$;

revoke all on function public.save_report_card_remarks(uuid, int, text, text, boolean, boolean) from public;
grant execute on function public.save_report_card_remarks(uuid, int, text, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Mark reviewed
-- ---------------------------------------------------------------------------
create or replace function public.mark_report_card_reviewed(
  p_report_card_id uuid,
  p_expected_revision int
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
  v_settings public.report_card_settings%rowtype;
  v_prev public.report_card_status;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not (
    public.has_academic_capability('REPORT_CARDS_REVIEW')
    or public.has_academic_capability('REPORT_CARDS_APPROVE')
  ) then
    raise exception 'You are not authorized to mark report cards reviewed.';
  end if;

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Report card not found.';
  end if;
  if v_card.revision is distinct from p_expected_revision then
    raise exception 'Revision conflict; refresh and try again.';
  end if;
  if v_card.status is distinct from 'DRAFT'::public.report_card_status then
    raise exception 'Only DRAFT report cards can be marked reviewed.';
  end if;
  if v_card.source_is_outdated then
    raise exception 'Report card is outdated relative to results; regenerate first.';
  end if;

  if not exists (
    select 1
    from public.student_term_result_snapshots s
    where s.id = v_card.term_result_snapshot_id
      and s.school_id = v_school
      and s.source_fingerprint = v_card.source_fingerprint
      and not s.is_stale
  ) then
    raise exception 'Results have changed; regenerate before review.';
  end if;

  perform public.report_card_assert_results_current(
    v_school, v_card.academic_year_id, v_card.term_id, v_card.class_id
  );

  select * into v_settings from public.report_card_settings where school_id = v_school;
  if found
     and v_settings.require_teacher_remark_for_review
     and nullif(btrim(coalesce(v_card.teacher_remark, '')), '') is null then
    raise exception 'Teacher remark is required before review.';
  end if;

  v_prev := v_card.status;
  update public.student_report_cards
  set
    status = 'REVIEWED'::public.report_card_status,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    revision = revision + 1
  where id = v_card.id
  returning * into v_card;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_REVIEWED', v_prev, v_card.status, auth.uid()
  );

  perform public.log_academic_event(
    'REPORT_CARD_REVIEWED',
    'student_report_card',
    v_card.id,
    jsonb_build_object('from_status', v_prev, 'to_status', v_card.status)
  );

  return v_card;
end;
$$;

revoke all on function public.mark_report_card_reviewed(uuid, int) from public;
grant execute on function public.mark_report_card_reviewed(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Approve: freeze immutable render payload after fingerprint re-check
-- ---------------------------------------------------------------------------
create or replace function public.approve_report_card(
  p_report_card_id uuid,
  p_expected_revision int,
  p_render_payload jsonb,
  p_render_payload_checksum text,
  p_source_fingerprint text
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
  v_term_snap public.student_term_result_snapshots%rowtype;
  v_settings public.report_card_settings%rowtype;
  v_prev public.report_card_status;
  v_checksum text := nullif(btrim(coalesce(p_render_payload_checksum, '')), '');
  v_fingerprint text := nullif(btrim(coalesce(p_source_fingerprint, '')), '');
  v_payload_subjects jsonb;
  v_subject record;
  v_row jsonb;
  v_db_subject_count int;
  v_payload_subject_count int;
  v_summary jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.has_academic_capability('REPORT_CARDS_APPROVE') then
    raise exception 'You are not authorized to approve report cards.';
  end if;
  if p_render_payload is null or jsonb_typeof(p_render_payload) <> 'object' then
    raise exception 'Render payload is required for approval.';
  end if;
  if v_checksum is null or length(v_checksum) < 32 then
    raise exception 'Checksum and source fingerprint are required.';
  end if;
  if v_fingerprint is null then
    raise exception 'Checksum and source fingerprint are required.';
  end if;

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Report card not found.';
  end if;
  if v_card.revision is distinct from p_expected_revision then
    raise exception 'Revision conflict; refresh and try again.';
  end if;
  if v_card.status not in (
    'DRAFT'::public.report_card_status,
    'REVIEWED'::public.report_card_status,
    'UNPUBLISHED'::public.report_card_status
  ) then
    raise exception 'Report card cannot be approved from the current status.';
  end if;
  if v_card.source_is_outdated then
    raise exception 'Report card is outdated; regenerate against current results.';
  end if;
  if v_card.source_fingerprint is distinct from v_fingerprint then
    raise exception 'Approval fingerprint does not match the report-card source.';
  end if;

  select * into v_term_snap
  from public.student_term_result_snapshots
  where id = v_card.term_result_snapshot_id
    and school_id = v_school;

  if not found then
    raise exception 'Linked term result snapshot is missing.';
  end if;
  if v_term_snap.source_fingerprint is distinct from v_fingerprint then
    raise exception 'Results have changed; regenerate before approval.';
  end if;
  if v_term_snap.is_stale then
    raise exception 'Results are stale; recalculate before approval.';
  end if;
  if v_term_snap.student_id is distinct from v_card.student_id
     or v_term_snap.class_id is distinct from v_card.class_id
     or v_term_snap.term_id is distinct from v_card.term_id
     or v_term_snap.academic_year_id is distinct from v_card.academic_year_id then
    raise exception 'Term snapshot scope does not match the report card.';
  end if;

  perform public.report_card_assert_results_current(
    v_school, v_card.academic_year_id, v_card.term_id, v_card.class_id
  );

  select * into v_settings from public.report_card_settings where school_id = v_school;
  if found
     and v_settings.require_headteacher_remark_for_approve
     and nullif(btrim(coalesce(v_card.headteacher_remark, '')), '') is null then
    raise exception 'Headteacher remark is required before approval.';
  end if;

  -- Identity / provenance must match the card and Phase 2D.1 source.
  if (p_render_payload->>'student_id') is distinct from v_card.student_id::text then
    raise exception 'Render payload student mismatch.';
  end if;
  if (p_render_payload->>'class_id') is distinct from v_card.class_id::text then
    raise exception 'Render payload class mismatch.';
  end if;
  if (p_render_payload->>'source_fingerprint') is distinct from v_fingerprint then
    raise exception 'Render payload fingerprint mismatch.';
  end if;
  if (p_render_payload->>'engine_version') is distinct from v_card.engine_version then
    raise exception 'Render payload engine version mismatch.';
  end if;
  if (p_render_payload->'academic_year'->>'id') is distinct from v_card.academic_year_id::text then
    raise exception 'Render payload academic year mismatch.';
  end if;
  if (p_render_payload->'term'->>'id') is distinct from v_card.term_id::text then
    raise exception 'Render payload term mismatch.';
  end if;

  -- Academic summary must equal the authoritative term snapshot (never trust browser totals).
  v_summary := p_render_payload->'summary';
  if v_summary is null or jsonb_typeof(v_summary) <> 'object' then
    raise exception 'Render payload summary is required.';
  end if;

  if (v_summary->>'average_percentage') is null then
    if v_term_snap.average_percentage is not null then
      raise exception 'Render payload average does not match Phase 2D.1 snapshot.';
    end if;
  elsif v_term_snap.average_percentage is null
     or (v_summary->>'average_percentage')::numeric is distinct from v_term_snap.average_percentage then
    raise exception 'Render payload average does not match Phase 2D.1 snapshot.';
  end if;

  if coalesce(v_summary->>'grade_code', '') is distinct from coalesce(v_term_snap.grade_code, '') then
    raise exception 'Render payload overall grade does not match Phase 2D.1 snapshot.';
  end if;

  if (v_summary->>'grade_point') is null then
    if v_term_snap.grade_point is not null then
      raise exception 'Render payload grade point does not match Phase 2D.1 snapshot.';
    end if;
  elsif v_term_snap.grade_point is null
     or (v_summary->>'grade_point')::numeric is distinct from v_term_snap.grade_point then
    raise exception 'Render payload grade point does not match Phase 2D.1 snapshot.';
  end if;

  if (v_summary->>'overall_position') is null then
    if v_term_snap.overall_position is not null then
      raise exception 'Render payload class position does not match Phase 2D.1 snapshot.';
    end if;
  elsif v_term_snap.overall_position is null
     or (v_summary->>'overall_position')::int is distinct from v_term_snap.overall_position then
    raise exception 'Render payload class position does not match Phase 2D.1 snapshot.';
  end if;

  if coalesce(v_summary->>'promotion_outcome', '')
     is distinct from coalesce(v_term_snap.promotion_outcome::text, '') then
    raise exception 'Render payload promotion recommendation does not match Phase 2D.1 snapshot.';
  end if;

  if coalesce((v_summary->>'passed_subject_count')::int, -1)
     is distinct from coalesce(v_term_snap.passed_subject_count, -1)
     or coalesce((v_summary->>'failed_subject_count')::int, -1)
        is distinct from coalesce(v_term_snap.failed_subject_count, -1) then
    raise exception 'Render payload pass/fail counts do not match Phase 2D.1 snapshot.';
  end if;

  -- Subject rows must match Phase 2D.1 subject snapshots exactly (by id).
  v_payload_subjects := coalesce(p_render_payload->'subjects', '[]'::jsonb);
  if jsonb_typeof(v_payload_subjects) <> 'array' then
    raise exception 'Render payload subjects must be an array.';
  end if;

  select count(*) into v_db_subject_count
  from public.student_subject_result_snapshots
  where school_id = v_school
    and academic_year_id = v_card.academic_year_id
    and term_id = v_card.term_id
    and class_id = v_card.class_id
    and student_id = v_card.student_id;

  v_payload_subject_count := jsonb_array_length(v_payload_subjects);
  if v_db_subject_count is distinct from v_payload_subject_count then
    raise exception 'Render payload subject count does not match Phase 2D.1 snapshots.';
  end if;

  for v_subject in
    select subject_id, weighted_percentage, grade_code, grade_point
    from public.student_subject_result_snapshots
    where school_id = v_school
      and academic_year_id = v_card.academic_year_id
      and term_id = v_card.term_id
      and class_id = v_card.class_id
      and student_id = v_card.student_id
  loop
    select elem
    into v_row
    from jsonb_array_elements(v_payload_subjects) as elem
    where elem->>'subject_id' = v_subject.subject_id::text
    limit 1;

    if v_row is null then
      raise exception 'Render payload is missing a Phase 2D.1 subject row.';
    end if;

    if (v_row->>'weighted_percentage') is null then
      if v_subject.weighted_percentage is not null then
        raise exception 'Render payload subject percentage does not match Phase 2D.1 snapshot.';
      end if;
    elsif v_subject.weighted_percentage is null
       or (v_row->>'weighted_percentage')::numeric
          is distinct from v_subject.weighted_percentage then
      raise exception 'Render payload subject percentage does not match Phase 2D.1 snapshot.';
    end if;

    if coalesce(v_row->>'grade_code', '') is distinct from coalesce(v_subject.grade_code, '') then
      raise exception 'Render payload subject grade does not match Phase 2D.1 snapshot.';
    end if;

    if (v_row->>'grade_point') is null then
      if v_subject.grade_point is not null then
        raise exception 'Render payload subject grade point does not match Phase 2D.1 snapshot.';
      end if;
    elsif v_subject.grade_point is null
       or (v_row->>'grade_point')::numeric is distinct from v_subject.grade_point then
      raise exception 'Render payload subject grade point does not match Phase 2D.1 snapshot.';
    end if;
  end loop;

  -- Remarks frozen into payload must match the locked card remarks.
  if coalesce(p_render_payload->'remarks'->>'teacher', '')
     is distinct from coalesce(v_card.teacher_remark, '') then
    raise exception 'Render payload teacher remark does not match saved remarks.';
  end if;
  if coalesce(p_render_payload->'remarks'->>'headteacher', '')
     is distinct from coalesce(v_card.headteacher_remark, '') then
    raise exception 'Render payload headteacher remark does not match saved remarks.';
  end if;

  -- Attendance must match the snapshot captured at draft generation (not browser-invented).
  if (p_render_payload->'attendance') is distinct from v_card.attendance_snapshot then
    raise exception 'Render payload attendance does not match the stored attendance snapshot.';
  end if;

  v_prev := v_card.status;
  update public.student_report_cards
  set
    status = 'APPROVED'::public.report_card_status,
    render_payload = p_render_payload,
    render_payload_checksum = v_checksum,
    approved_by = auth.uid(),
    approved_at = now(),
    revision = revision + 1
  where id = v_card.id
  returning * into v_card;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status,
    metadata, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_APPROVED', v_prev, v_card.status,
    jsonb_build_object(
      'checksum', v_checksum,
      'source_fingerprint', v_fingerprint
    ),
    auth.uid()
  );

  perform public.log_academic_event(
    'REPORT_CARD_APPROVED',
    'student_report_card',
    v_card.id,
    jsonb_build_object(
      'from_status', v_prev,
      'to_status', v_card.status,
      'source_fingerprint', v_fingerprint
    )
  );

  return v_card;
end;
$$;

revoke all on function public.approve_report_card(uuid, int, jsonb, text, text) from public;
grant execute on function public.approve_report_card(uuid, int, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Publish / unpublish / void
-- ---------------------------------------------------------------------------
create or replace function public.publish_report_card(
  p_report_card_id uuid,
  p_expected_revision int
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
  v_prev public.report_card_status;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.has_academic_capability('REPORT_CARDS_PUBLISH') then
    raise exception 'You are not authorized to publish report cards.';
  end if;

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Report card not found.';
  end if;
  if v_card.revision is distinct from p_expected_revision then
    raise exception 'Revision conflict; refresh and try again.';
  end if;
  if v_card.status not in (
    'APPROVED'::public.report_card_status,
    'UNPUBLISHED'::public.report_card_status
  ) then
    raise exception 'Only APPROVED or UNPUBLISHED report cards can be published.';
  end if;
  if v_card.render_payload is null or v_card.render_payload_checksum is null then
    raise exception 'Immutable render snapshot is required before publication.';
  end if;
  if (v_card.render_payload->>'source_fingerprint')
     is distinct from v_card.source_fingerprint then
    raise exception 'Published snapshot fingerprint does not match approved source.';
  end if;
  if length(btrim(v_card.render_payload_checksum)) < 32 then
    raise exception 'Immutable render snapshot checksum is invalid.';
  end if;

  v_prev := v_card.status;
  update public.student_report_cards
  set
    status = 'PUBLISHED'::public.report_card_status,
    published_by = auth.uid(),
    published_at = now(),
    unpublished_by = null,
    unpublished_at = null,
    revision = revision + 1
  where id = v_card.id
  returning * into v_card;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_PUBLISHED', v_prev, v_card.status, auth.uid()
  );

  perform public.log_academic_event(
    'REPORT_CARD_PUBLISHED',
    'student_report_card',
    v_card.id,
    jsonb_build_object('from_status', v_prev, 'to_status', v_card.status)
  );

  return v_card;
end;
$$;

revoke all on function public.publish_report_card(uuid, int) from public;
grant execute on function public.publish_report_card(uuid, int) to authenticated;

create or replace function public.unpublish_report_card(
  p_report_card_id uuid,
  p_expected_revision int,
  p_reason text default null
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
  v_prev public.report_card_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.has_academic_capability('REPORT_CARDS_PUBLISH') then
    raise exception 'You are not authorized to unpublish report cards.';
  end if;

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Report card not found.';
  end if;
  if v_card.revision is distinct from p_expected_revision then
    raise exception 'Revision conflict; refresh and try again.';
  end if;
  if v_card.status is distinct from 'PUBLISHED'::public.report_card_status then
    raise exception 'Only PUBLISHED report cards can be unpublished.';
  end if;

  v_prev := v_card.status;
  update public.student_report_cards
  set
    status = 'UNPUBLISHED'::public.report_card_status,
    unpublished_by = auth.uid(),
    unpublished_at = now(),
    revision = revision + 1
  where id = v_card.id
  returning * into v_card;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_UNPUBLISHED', v_prev, v_card.status, v_reason, auth.uid()
  );

  perform public.log_academic_event(
    'REPORT_CARD_UNPUBLISHED',
    'student_report_card',
    v_card.id,
    jsonb_build_object('from_status', v_prev, 'to_status', v_card.status)
  );

  return v_card;
end;
$$;

revoke all on function public.unpublish_report_card(uuid, int, text) from public;
grant execute on function public.unpublish_report_card(uuid, int, text) to authenticated;

create or replace function public.void_report_card(
  p_report_card_id uuid,
  p_expected_revision int,
  p_reason text
)
returns public.student_report_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
  v_prev public.report_card_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not (
    public.has_academic_capability('REPORT_CARDS_APPROVE')
    or public.has_academic_capability('REPORT_CARDS_PUBLISH')
  ) then
    raise exception 'You are not authorized to void report cards.';
  end if;
  if v_reason is null then
    raise exception 'A void reason is required.';
  end if;

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Report card not found.';
  end if;
  if v_card.revision is distinct from p_expected_revision then
    raise exception 'Revision conflict; refresh and try again.';
  end if;
  if v_card.status = 'VOIDED'::public.report_card_status then
    raise exception 'Report card is already voided.';
  end if;
  if v_card.status = 'PUBLISHED'::public.report_card_status then
    raise exception 'Unpublish before voiding a published report card.';
  end if;

  v_prev := v_card.status;
  update public.student_report_cards
  set
    status = 'VOIDED'::public.report_card_status,
    voided_by = auth.uid(),
    voided_at = now(),
    void_reason = v_reason,
    revision = revision + 1
  where id = v_card.id
  returning * into v_card;

  insert into public.report_card_events (
    school_id, report_card_id, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_school, v_card.id, 'REPORT_CARD_VOIDED', v_prev, v_card.status, v_reason, auth.uid()
  );

  perform public.log_academic_event(
    'REPORT_CARD_VOIDED',
    'student_report_card',
    v_card.id,
    jsonb_build_object('from_status', v_prev, 'to_status', v_card.status)
  );

  return v_card;
end;
$$;

revoke all on function public.void_report_card(uuid, int, text) from public;
grant execute on function public.void_report_card(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Update school report-card settings (does not mutate published payloads)
-- ---------------------------------------------------------------------------
create or replace function public.update_report_card_settings(
  p_title text default null,
  p_show_school_logo boolean default null,
  p_show_admission_number boolean default null,
  p_show_class_position boolean default null,
  p_show_subject_position boolean default null,
  p_show_grade_points boolean default null,
  p_show_promotion_recommendation boolean default null,
  p_show_attendance boolean default null,
  p_show_teacher_remark boolean default null,
  p_show_headteacher_remark boolean default null,
  p_show_grading_key boolean default null,
  p_show_generated_timestamp boolean default null,
  p_require_teacher_remark_for_review boolean default null,
  p_require_headteacher_remark_for_approve boolean default null,
  p_footer_text text default null,
  p_ranking_disabled_message text default null
)
returns public.report_card_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_row public.report_card_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.has_academic_capability('REPORT_CARD_SETTINGS_MANAGE') then
    raise exception 'You are not authorized to manage report-card settings.';
  end if;
  if v_school is null then
    raise exception 'No school context.';
  end if;

  perform public.ensure_report_card_settings();

  update public.report_card_settings
  set
    title = coalesce(nullif(btrim(p_title), ''), title),
    show_school_logo = coalesce(p_show_school_logo, show_school_logo),
    show_admission_number = coalesce(p_show_admission_number, show_admission_number),
    show_class_position = coalesce(p_show_class_position, show_class_position),
    show_subject_position = coalesce(p_show_subject_position, show_subject_position),
    show_grade_points = coalesce(p_show_grade_points, show_grade_points),
    show_promotion_recommendation = coalesce(
      p_show_promotion_recommendation, show_promotion_recommendation
    ),
    show_attendance = coalesce(p_show_attendance, show_attendance),
    show_teacher_remark = coalesce(p_show_teacher_remark, show_teacher_remark),
    show_headteacher_remark = coalesce(
      p_show_headteacher_remark, show_headteacher_remark
    ),
    show_grading_key = coalesce(p_show_grading_key, show_grading_key),
    show_generated_timestamp = coalesce(
      p_show_generated_timestamp, show_generated_timestamp
    ),
    require_teacher_remark_for_review = coalesce(
      p_require_teacher_remark_for_review, require_teacher_remark_for_review
    ),
    require_headteacher_remark_for_approve = coalesce(
      p_require_headteacher_remark_for_approve,
      require_headteacher_remark_for_approve
    ),
    footer_text = case
      when p_footer_text is null then footer_text
      when btrim(p_footer_text) = '' then null
      else left(btrim(p_footer_text), 2000)
    end,
    ranking_disabled_message = coalesce(
      nullif(btrim(p_ranking_disabled_message), ''),
      ranking_disabled_message
    ),
    updated_by = auth.uid()
  where school_id = v_school
  returning * into v_row;

  perform public.log_academic_event(
    'REPORT_CARD_SETTINGS_CHANGED',
    'report_card_settings',
    v_school,
    jsonb_build_object('title', v_row.title)
  );

  return v_row;
end;
$$;

revoke all on function public.update_report_card_settings(
  text, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean, boolean, text, text
) from public;
grant execute on function public.update_report_card_settings(
  text, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean, boolean, text, text
) to authenticated;
