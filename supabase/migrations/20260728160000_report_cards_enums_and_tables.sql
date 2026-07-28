-- ===========================================================================
-- Phase 2D.2 — Report cards: enums, settings, student report cards, events
-- Additive only. Consumes Phase 2D.1 snapshots; does not store a second marks engine.
-- ===========================================================================

do $$ begin
  create type public.report_card_status as enum (
    'DRAFT',
    'REVIEWED',
    'APPROVED',
    'PUBLISHED',
    'UNPUBLISHED',
    'VOIDED'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- School report-card settings
-- ---------------------------------------------------------------------------
create table if not exists public.report_card_settings (
  school_id uuid primary key references public.schools(id) on delete restrict,
  title text not null default 'Term Report Card',
  show_school_logo boolean not null default true,
  show_admission_number boolean not null default true,
  show_class_position boolean not null default true,
  show_subject_position boolean not null default false,
  show_grade_points boolean not null default true,
  show_promotion_recommendation boolean not null default true,
  show_attendance boolean not null default true,
  show_teacher_remark boolean not null default true,
  show_headteacher_remark boolean not null default true,
  show_grading_key boolean not null default true,
  show_generated_timestamp boolean not null default true,
  require_teacher_remark_for_review boolean not null default false,
  require_headteacher_remark_for_approve boolean not null default true,
  footer_text text,
  ranking_disabled_message text not null default 'Class ranking is not published for this term.',
  template_version text not null default '2d.2.1',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_card_settings_title_not_blank check (btrim(title) <> '')
);

create trigger report_card_settings_set_updated_at
before update on public.report_card_settings
for each row execute function public.set_updated_at();

comment on table public.report_card_settings is
  'Phase 2D.2 report-card presentation defaults (not academic calculation).';

-- ---------------------------------------------------------------------------
-- Student report cards (one live row per student × year × term × class)
-- ---------------------------------------------------------------------------
create table if not exists public.student_report_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id uuid not null references public.terms(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  status public.report_card_status not null default 'DRAFT',
  revision int not null default 1,
  -- Phase 2D.1 provenance (authoritative academic source)
  term_result_snapshot_id uuid references public.student_term_result_snapshots(id) on delete restrict,
  source_fingerprint text not null,
  engine_version text not null,
  computation_batch_id uuid not null,
  source_is_outdated boolean not null default false,
  -- Live remarks (frozen into render_payload on approval)
  teacher_remark text,
  teacher_remark_by uuid references public.profiles(id) on delete set null,
  teacher_remark_at timestamptz,
  headteacher_remark text,
  headteacher_remark_by uuid references public.profiles(id) on delete set null,
  headteacher_remark_at timestamptz,
  -- Attendance summary captured at draft generation / refreshed on regenerate
  attendance_snapshot jsonb not null default '{}'::jsonb,
  -- Immutable document payload frozen at approval (null until APPROVED+)
  render_payload jsonb,
  render_payload_checksum text,
  template_version text not null default '2d.2.1',
  settings_snapshot jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  unpublished_by uuid references public.profiles(id) on delete set null,
  unpublished_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_report_cards_revision_check check (revision >= 1),
  constraint student_report_cards_teacher_remark_len
    check (teacher_remark is null or char_length(teacher_remark) <= 2000),
  constraint student_report_cards_head_remark_len
    check (headteacher_remark is null or char_length(headteacher_remark) <= 2000),
  constraint student_report_cards_void_reason_check
    check (
      status <> 'VOIDED'::public.report_card_status
      or (void_reason is not null and btrim(void_reason) <> '')
    ),
  constraint student_report_cards_approved_payload_check
    check (
      status not in (
        'APPROVED'::public.report_card_status,
        'PUBLISHED'::public.report_card_status,
        'UNPUBLISHED'::public.report_card_status
      )
      or (
        render_payload is not null
        and render_payload_checksum is not null
      )
    ),
  unique (school_id, academic_year_id, term_id, class_id, student_id)
);

create trigger student_report_cards_set_updated_at
before update on public.student_report_cards
for each row execute function public.set_updated_at();

create index if not exists student_report_cards_class_term_idx
  on public.student_report_cards (
    school_id, academic_year_id, term_id, class_id, status
  );

create index if not exists student_report_cards_student_idx
  on public.student_report_cards (school_id, student_id);

create index if not exists student_report_cards_fingerprint_idx
  on public.student_report_cards (school_id, source_fingerprint);

-- ---------------------------------------------------------------------------
-- Lifecycle / publication events (history; never delete)
-- ---------------------------------------------------------------------------
create table if not exists public.report_card_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  report_card_id uuid not null references public.student_report_cards(id) on delete restrict,
  event_type text not null,
  from_status public.report_card_status,
  to_status public.report_card_status,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint report_card_events_type_not_blank check (btrim(event_type) <> '')
);

create index if not exists report_card_events_card_idx
  on public.report_card_events (report_card_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Visibility helper (class-scoped; term-aware via can_view_class_results)
-- ---------------------------------------------------------------------------
create or replace function public.can_view_report_card(p_report_card_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_card public.student_report_cards%rowtype;
begin
  if auth.uid() is null or v_school is null or p_report_card_id is null then
    return false;
  end if;

  if public.has_academic_capability('REPORT_CARDS_VIEW_ALL') then
    return true;
  end if;

  if not public.has_academic_capability('REPORT_CARDS_VIEW') then
    return false;
  end if;

  select * into v_card
  from public.student_report_cards
  where id = p_report_card_id and school_id = v_school;

  if not found then
    return false;
  end if;

  return public.can_view_class_results(v_card.class_id, v_card.term_id);
end;
$$;

revoke all on function public.can_view_report_card(uuid) from public;
grant execute on function public.can_view_report_card(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.report_card_settings enable row level security;
alter table public.student_report_cards enable row level security;
alter table public.report_card_events enable row level security;

revoke all on table public.report_card_settings from public, anon, authenticated;
revoke all on table public.student_report_cards from public, anon, authenticated;
revoke all on table public.report_card_events from public, anon, authenticated;

grant select on table public.report_card_settings to authenticated;
grant select on table public.student_report_cards to authenticated;
grant select on table public.report_card_events to authenticated;

create policy report_card_settings_select on public.report_card_settings
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('REPORT_CARDS_VIEW')
      or public.has_academic_capability('REPORT_CARDS_VIEW_ALL')
      or public.has_academic_capability('REPORT_CARD_SETTINGS_MANAGE')
    )
  );

create policy student_report_cards_select on public.student_report_cards
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('REPORT_CARDS_VIEW_ALL')
      or (
        public.has_academic_capability('REPORT_CARDS_VIEW')
        and public.can_view_class_results(class_id, term_id)
      )
    )
  );

create policy report_card_events_select on public.report_card_events
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_view_report_card(report_card_id)
  );
