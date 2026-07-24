-- ===========================================================================
-- Phase 2D.1 — Academic Results Engine: enums, settings, policies, snapshots
-- Additive only. Does not alter gradebook marks storage.
-- Amended in pre-commit review: provenance, constraints, scoped RLS.
-- ===========================================================================

do $$ begin
  create type public.results_ranking_tie_mode as enum (
    'COMPETITION', 'DENSE', 'AVERAGE', 'DISABLED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.promotion_outcome as enum (
    'PROMOTED', 'CONDITIONAL', 'REPEAT', 'GRADUATED', 'UNDECIDED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.promotion_rule_type as enum (
    'MIN_AVERAGE', 'MIN_PASS_SUBJECTS', 'MAX_FAIL_SUBJECTS', 'MIN_PASS_RATE', 'ALWAYS'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.result_statistic_scope as enum (
    'CLASS_TERM', 'CLASS_SUBJECT_TERM'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- School settings
-- ---------------------------------------------------------------------------
create table if not exists public.academic_results_settings (
  school_id uuid primary key references public.schools(id) on delete restrict,
  ranking_enabled boolean not null default true,
  ranking_tie_mode public.results_ranking_tie_mode not null default 'COMPETITION',
  treat_absent_as_zero boolean not null default false,
  include_exempt_in_average boolean not null default false,
  include_not_assessed_in_average boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger academic_results_settings_set_updated_at
before update on public.academic_results_settings
for each row execute function public.set_updated_at();

comment on table public.academic_results_settings is
  'Phase 2D.1 results engine school defaults (ranking + average inclusion).';

comment on column public.academic_results_settings.include_exempt_in_average is
  'Reserved. EXEMPT never invents a numeric mark; averages always omit null percentages.';
comment on column public.academic_results_settings.include_not_assessed_in_average is
  'Reserved. NOT_ASSESSED never invents a numeric mark; averages always omit null percentages.';

-- ---------------------------------------------------------------------------
-- Promotion policies (data-driven; recommendations only)
-- ---------------------------------------------------------------------------
create table if not exists public.promotion_policies (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  grade_level_id uuid references public.grade_levels(id) on delete set null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  version int not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotion_policies_name_not_blank check (btrim(name) <> '')
);

create trigger promotion_policies_set_updated_at
before update on public.promotion_policies
for each row execute function public.set_updated_at();

create unique index if not exists promotion_policies_one_default_uidx
  on public.promotion_policies (school_id)
  where is_default and is_active;

create table if not exists public.promotion_policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.promotion_policies(id) on delete cascade,
  rule_type public.promotion_rule_type not null,
  outcome public.promotion_outcome not null,
  threshold_numeric numeric(8,2),
  threshold_int int,
  priority int not null default 100,
  label text,
  constraint promotion_policy_rules_outcome_check
    check (outcome in (
      'PROMOTED'::public.promotion_outcome,
      'CONDITIONAL'::public.promotion_outcome,
      'REPEAT'::public.promotion_outcome,
      'GRADUATED'::public.promotion_outcome
    ))
);

create index if not exists promotion_policy_rules_policy_idx
  on public.promotion_policy_rules (policy_id, priority);

-- ---------------------------------------------------------------------------
-- Computed snapshots (engine output — not a second marks store)
-- Uniqueness:
--   exam: school + year + term + class + exam + student
--     (class-scoped so mid-year transfers do not collide with prior class rows)
--   subject: school + year + term + class + subject + student
--   term: school + year + term + class + student
-- ---------------------------------------------------------------------------
create table if not exists public.student_exam_result_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id uuid not null references public.terms(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  exam_id uuid not null references public.exams(id) on delete restrict,
  gradebook_id uuid not null references public.exam_gradebooks(id) on delete restrict,
  gradebook_revision int not null,
  assessment_type_id uuid references public.assessment_types(id) on delete set null,
  student_id uuid not null references public.students(id) on delete restrict,
  entry_status public.result_entry_status not null,
  marks_obtained numeric(8,2),
  max_marks numeric(8,2) not null,
  percentage numeric(8,2),
  grade_code text,
  grade_label text,
  grade_point numeric(6,2),
  is_pass boolean,
  remark text,
  grading_scheme_id uuid references public.grading_schemes(id) on delete set null,
  grading_scheme_version int,
  grading_scheme_snapshot jsonb not null default '{}'::jsonb,
  engine_version text not null,
  source_fingerprint text not null,
  computation_batch_id uuid not null,
  computed_at timestamptz not null default now(),
  computed_by uuid references public.profiles(id) on delete set null,
  constraint student_exam_result_snapshots_max_marks_check check (max_marks > 0),
  constraint student_exam_result_snapshots_percentage_check
    check (percentage is null or (percentage >= 0 and percentage <= 100)),
  constraint student_exam_result_snapshots_revision_check check (gradebook_revision >= 1),
  unique (school_id, academic_year_id, term_id, class_id, exam_id, student_id)
);

create index if not exists student_exam_result_snapshots_class_term_idx
  on public.student_exam_result_snapshots (
    school_id, academic_year_id, term_id, class_id
  );

create table if not exists public.student_subject_result_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id uuid not null references public.terms(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  weighted_percentage numeric(8,2),
  grade_code text,
  grade_label text,
  grade_point numeric(6,2),
  is_pass boolean,
  remark text,
  subject_position numeric(8,2),
  tied_count int not null default 0,
  components jsonb not null default '[]'::jsonb,
  weight_scheme_id uuid references public.assessment_weight_schemes(id) on delete set null,
  weight_scheme_snapshot jsonb not null default '[]'::jsonb,
  grading_scheme_id uuid references public.grading_schemes(id) on delete set null,
  grading_scheme_version int,
  grading_scheme_snapshot jsonb not null default '{}'::jsonb,
  engine_version text not null,
  source_fingerprint text not null,
  computation_batch_id uuid not null,
  computed_at timestamptz not null default now(),
  computed_by uuid references public.profiles(id) on delete set null,
  constraint student_subject_result_snapshots_pct_check
    check (weighted_percentage is null or (weighted_percentage >= 0 and weighted_percentage <= 100)),
  constraint student_subject_result_snapshots_pos_check
    check (subject_position is null or subject_position >= 1),
  constraint student_subject_result_snapshots_tie_check check (tied_count >= 0),
  unique (school_id, academic_year_id, term_id, class_id, subject_id, student_id)
);

create index if not exists student_subject_result_snapshots_lookup_idx
  on public.student_subject_result_snapshots (
    school_id, academic_year_id, term_id, class_id, subject_id
  );

create table if not exists public.student_term_result_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id uuid not null references public.terms(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  subject_count int not null default 0,
  scored_subject_count int not null default 0,
  passed_subject_count int not null default 0,
  failed_subject_count int not null default 0,
  average_percentage numeric(8,2),
  grade_code text,
  grade_label text,
  grade_point numeric(6,2),
  is_pass boolean,
  remark text,
  overall_position numeric(8,2),
  tied_count int not null default 0,
  promotion_outcome public.promotion_outcome not null default 'UNDECIDED',
  promotion_reason text,
  grading_scheme_id uuid references public.grading_schemes(id) on delete set null,
  grading_scheme_version int,
  grading_scheme_snapshot jsonb not null default '{}'::jsonb,
  promotion_policy_id uuid references public.promotion_policies(id) on delete set null,
  promotion_policy_snapshot jsonb not null default '[]'::jsonb,
  engine_version text not null,
  source_fingerprint text not null,
  is_stale boolean not null default false,
  computation_batch_id uuid not null,
  computed_at timestamptz not null default now(),
  computed_by uuid references public.profiles(id) on delete set null,
  constraint student_term_result_snapshots_pct_check
    check (average_percentage is null or (average_percentage >= 0 and average_percentage <= 100)),
  constraint student_term_result_snapshots_pos_check
    check (overall_position is null or overall_position >= 1),
  constraint student_term_result_snapshots_tie_check check (tied_count >= 0),
  constraint student_term_result_snapshots_counts_check check (
    subject_count >= 0
    and scored_subject_count >= 0
    and passed_subject_count >= 0
    and failed_subject_count >= 0
    and scored_subject_count <= subject_count
    and passed_subject_count + failed_subject_count <= scored_subject_count
  ),
  unique (school_id, academic_year_id, term_id, class_id, student_id)
);

create index if not exists student_term_result_snapshots_lookup_idx
  on public.student_term_result_snapshots (
    school_id, academic_year_id, term_id, class_id
  );

create table if not exists public.result_statistic_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id uuid not null references public.terms(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  subject_id uuid references public.subjects(id) on delete restrict,
  scope public.result_statistic_scope not null,
  stats jsonb not null default '{}'::jsonb,
  engine_version text not null,
  source_fingerprint text not null,
  computation_batch_id uuid not null,
  computed_at timestamptz not null default now(),
  computed_by uuid references public.profiles(id) on delete set null,
  constraint result_statistic_snapshots_scope_subject_check check (
    (
      scope = 'CLASS_TERM'::public.result_statistic_scope
      and subject_id is null
    )
    or (
      scope = 'CLASS_SUBJECT_TERM'::public.result_statistic_scope
      and subject_id is not null
    )
  )
);

create unique index if not exists result_statistic_snapshots_class_term_uidx
  on public.result_statistic_snapshots (
    school_id, academic_year_id, term_id, class_id
  )
  where scope = 'CLASS_TERM'::public.result_statistic_scope;

create unique index if not exists result_statistic_snapshots_class_subject_uidx
  on public.result_statistic_snapshots (
    school_id, academic_year_id, term_id, class_id, subject_id
  )
  where scope = 'CLASS_SUBJECT_TERM'::public.result_statistic_scope
    and subject_id is not null;

-- ---------------------------------------------------------------------------
-- Teacher class/subject visibility (SECURITY DEFINER; used by RLS)
-- ---------------------------------------------------------------------------
create or replace function public.can_view_class_results(
  p_class_id uuid,
  p_term_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_class public.classes%rowtype;
begin
  if auth.uid() is null or v_school is null or p_class_id is null then
    return false;
  end if;

  if public.has_academic_capability('RESULTS_VIEW_ALL') then
    return true;
  end if;

  if not public.has_academic_capability('RESULTS_VIEW') then
    return false;
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id and school_id = v_school;

  if not found then
    return false;
  end if;

  return exists (
    select 1
    from public.teaching_assignments ta
    join public.subject_offerings so on so.id = ta.subject_offering_id
    where ta.school_id = v_school
      and ta.staff_id = auth.uid()
      and ta.is_active
      and so.is_active
      and so.school_id = v_school
      and so.academic_year_id = v_class.academic_year_id
      and so.grade_level_id = v_class.grade_level_id
      and (ta.class_id is null or ta.class_id = p_class_id)
      and (so.class_id is null or so.class_id = p_class_id)
      and (
        p_term_id is null
        or so.term_id is null
        or so.term_id = p_term_id
      )
  );
end;
$$;

-- Actual PG signatures include DEFAULT args; GRANT/REVOKE must use full arg lists.
revoke all on function public.can_view_class_results(uuid, uuid) from public;
grant execute on function public.can_view_class_results(uuid, uuid) to authenticated;

create or replace function public.can_view_subject_results(
  p_class_id uuid,
  p_subject_id uuid,
  p_term_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_class public.classes%rowtype;
begin
  if auth.uid() is null or v_school is null or p_class_id is null or p_subject_id is null then
    return false;
  end if;

  if public.has_academic_capability('RESULTS_VIEW_ALL') then
    return true;
  end if;

  if not public.has_academic_capability('RESULTS_VIEW') then
    return false;
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id and school_id = v_school;

  if not found then
    return false;
  end if;

  return exists (
    select 1
    from public.teaching_assignments ta
    join public.subject_offerings so on so.id = ta.subject_offering_id
    where ta.school_id = v_school
      and ta.staff_id = auth.uid()
      and ta.is_active
      and so.is_active
      and so.school_id = v_school
      and so.subject_id = p_subject_id
      and so.academic_year_id = v_class.academic_year_id
      and so.grade_level_id = v_class.grade_level_id
      and (ta.class_id is null or ta.class_id = p_class_id)
      and (so.class_id is null or so.class_id = p_class_id)
      and (
        p_term_id is null
        or so.term_id is null
        or so.term_id = p_term_id
      )
  );
end;
$$;

revoke all on function public.can_view_subject_results(uuid, uuid, uuid) from public;
grant execute on function public.can_view_subject_results(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: enable + deny direct DML
-- ---------------------------------------------------------------------------
alter table public.academic_results_settings enable row level security;
alter table public.promotion_policies enable row level security;
alter table public.promotion_policy_rules enable row level security;
alter table public.student_exam_result_snapshots enable row level security;
alter table public.student_subject_result_snapshots enable row level security;
alter table public.student_term_result_snapshots enable row level security;
alter table public.result_statistic_snapshots enable row level security;

revoke all on table public.academic_results_settings from public, anon, authenticated;
revoke all on table public.promotion_policies from public, anon, authenticated;
revoke all on table public.promotion_policy_rules from public, anon, authenticated;
revoke all on table public.student_exam_result_snapshots from public, anon, authenticated;
revoke all on table public.student_subject_result_snapshots from public, anon, authenticated;
revoke all on table public.student_term_result_snapshots from public, anon, authenticated;
revoke all on table public.result_statistic_snapshots from public, anon, authenticated;

grant select on table public.academic_results_settings to authenticated;
grant select on table public.promotion_policies to authenticated;
grant select on table public.promotion_policy_rules to authenticated;
grant select on table public.student_exam_result_snapshots to authenticated;
grant select on table public.student_subject_result_snapshots to authenticated;
grant select on table public.student_term_result_snapshots to authenticated;
grant select on table public.result_statistic_snapshots to authenticated;

create policy academic_results_settings_select on public.academic_results_settings
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('RESULTS_VIEW')
      or public.has_academic_capability('RESULTS_VIEW_ALL')
      or public.has_academic_capability('RESULTS_RECALCULATE')
    )
  );

create policy promotion_policies_select on public.promotion_policies
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('RESULTS_VIEW_ALL')
      or public.has_academic_capability('PROMOTION_POLICIES_MANAGE')
    )
  );

create policy promotion_policy_rules_select on public.promotion_policy_rules
  for select to authenticated
  using (
    exists (
      select 1 from public.promotion_policies p
      where p.id = policy_id
        and p.school_id = public.current_user_school_id()
    )
    and (
      public.has_academic_capability('RESULTS_VIEW_ALL')
      or public.has_academic_capability('PROMOTION_POLICIES_MANAGE')
    )
  );

create policy student_exam_result_snapshots_select on public.student_exam_result_snapshots
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('RESULTS_VIEW_ALL')
      or public.can_view_subject_results(class_id, subject_id, term_id)
    )
  );

create policy student_subject_result_snapshots_select on public.student_subject_result_snapshots
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('RESULTS_VIEW_ALL')
      or public.can_view_subject_results(class_id, subject_id, term_id)
    )
  );

create policy student_term_result_snapshots_select on public.student_term_result_snapshots
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('RESULTS_VIEW_ALL')
      or public.can_view_class_results(class_id, term_id)
    )
  );

create policy result_statistic_snapshots_select on public.result_statistic_snapshots
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.has_academic_capability('RESULTS_VIEW_ALL')
      or (
        subject_id is null and public.can_view_class_results(class_id, term_id)
      )
      or (
        subject_id is not null
        and public.can_view_subject_results(class_id, subject_id, term_id)
      )
    )
  );
