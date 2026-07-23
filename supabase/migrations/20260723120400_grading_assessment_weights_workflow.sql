-- ===========================================================================
-- Phase 2A.4 — Grading schemes, assessment types, weight schemes, workflow dates
-- ===========================================================================

do $$ begin
  create type public.grading_scheme_type as enum (
    'PERCENTAGE_BANDS', 'LETTER', 'GPA', 'PASS_FAIL', 'COMPETENCY', 'CUSTOM'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.grading_schemes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  name             text not null,
  scheme_type      public.grading_scheme_type not null default 'PERCENTAGE_BANDS',
  academic_year_id uuid references public.academic_years(id) on delete set null,
  term_id          uuid references public.terms(id) on delete set null,
  grade_level_id   uuid references public.grade_levels(id) on delete set null,
  subject_id       uuid references public.subjects(id) on delete set null,
  min_score        numeric(8,2) not null default 0,
  max_score        numeric(8,2) not null default 100,
  decimal_places   int not null default 0,
  rounding_mode    text not null default 'half_up',
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  version          int not null default 1,
  effective_from   date,
  effective_to     date,
  created_by       uuid references public.profiles(id) on delete set null,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint grading_schemes_range_check check (min_score < max_score),
  constraint grading_schemes_name_not_blank check (btrim(name) <> '')
);

create trigger grading_schemes_set_updated_at
before update on public.grading_schemes
for each row execute function public.set_updated_at();

create unique index if not exists grading_schemes_one_default_uidx
  on public.grading_schemes (school_id)
  where is_default and is_active and archived_at is null;

create table if not exists public.grading_scheme_bands (
  id                      uuid primary key default gen_random_uuid(),
  grading_scheme_id       uuid not null references public.grading_schemes(id) on delete cascade,
  minimum_score           numeric(8,2) not null,
  maximum_score           numeric(8,2) not null,
  grade_code              text not null,
  grade_label             text not null,
  grade_point             numeric(6,2),
  performance_description text,
  is_pass                 boolean not null default true,
  display_order           int not null default 0,
  constraint grading_scheme_bands_range_check check (minimum_score <= maximum_score)
);

create unique index if not exists grading_scheme_bands_code_uidx
  on public.grading_scheme_bands (grading_scheme_id, lower(btrim(grade_code)));

create table if not exists public.assessment_types (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete restrict,
  name                 text not null,
  code                 text,
  category             text not null default 'GENERAL',
  description          text,
  default_maximum_mark numeric(8,2) not null default 100,
  is_exam              boolean not null default false,
  is_active            boolean not null default true,
  display_order        int not null default 0,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint assessment_types_name_not_blank check (btrim(name) <> ''),
  constraint assessment_types_max_check check (default_maximum_mark > 0)
);

create trigger assessment_types_set_updated_at
before update on public.assessment_types
for each row execute function public.set_updated_at();

create unique index if not exists assessment_types_school_name_uidx
  on public.assessment_types (school_id, lower(btrim(name)));

create table if not exists public.assessment_weight_schemes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  name             text not null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  term_id          uuid references public.terms(id) on delete set null,
  grade_level_id   uuid references public.grade_levels(id) on delete set null,
  class_id         uuid references public.classes(id) on delete set null,
  subject_id       uuid references public.subjects(id) on delete set null,
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  version          int not null default 1,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint assessment_weight_schemes_name_not_blank check (btrim(name) <> '')
);

create trigger assessment_weight_schemes_set_updated_at
before update on public.assessment_weight_schemes
for each row execute function public.set_updated_at();

create unique index if not exists assessment_weight_schemes_one_default_uidx
  on public.assessment_weight_schemes (school_id)
  where is_default and is_active;

create table if not exists public.assessment_weight_items (
  id                 uuid primary key default gen_random_uuid(),
  scheme_id          uuid not null references public.assessment_weight_schemes(id) on delete cascade,
  assessment_type_id uuid not null references public.assessment_types(id) on delete restrict,
  weight_percentage  numeric(6,2) not null,
  display_order      int not null default 0,
  constraint assessment_weight_items_pct_check
    check (weight_percentage >= 0 and weight_percentage <= 100),
  unique (scheme_id, assessment_type_id)
);

create table if not exists public.academic_workflow_periods (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id          uuid references public.terms(id) on delete restrict,
  workflow_type    text not null,
  starts_at        date not null,
  ends_at          date,
  notes            text,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint academic_workflow_periods_type_check
    check (workflow_type in (
      'MARKS_ENTRY',
      'MODERATION',
      'APPROVAL',
      'PUBLICATION'
    )),
  constraint academic_workflow_periods_dates_check
    check (ends_at is null or ends_at >= starts_at)
);

create trigger academic_workflow_periods_set_updated_at
before update on public.academic_workflow_periods
for each row execute function public.set_updated_at();

create unique index if not exists academic_workflow_periods_scope_uidx
  on public.academic_workflow_periods (
    school_id,
    academic_year_id,
    coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid),
    workflow_type
  )
  where is_active;

-- RLS
alter table public.grading_schemes enable row level security;
alter table public.grading_scheme_bands enable row level security;
alter table public.assessment_types enable row level security;
alter table public.assessment_weight_schemes enable row level security;
alter table public.assessment_weight_items enable row level security;
alter table public.academic_workflow_periods enable row level security;

create policy "grading_schemes_select" on public.grading_schemes
  for select to authenticated
  using (school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW'));

create policy "grading_scheme_bands_select" on public.grading_scheme_bands
  for select to authenticated
  using (
    exists (
      select 1 from public.grading_schemes s
      where s.id = grading_scheme_id
        and s.school_id = public.current_user_school_id()
    )
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW')
  );

create policy "assessment_types_select" on public.assessment_types
  for select to authenticated
  using (school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW'));

create policy "assessment_weight_schemes_select" on public.assessment_weight_schemes
  for select to authenticated
  using (school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW'));

create policy "assessment_weight_items_select" on public.assessment_weight_items
  for select to authenticated
  using (
    exists (
      select 1 from public.assessment_weight_schemes s
      where s.id = scheme_id and s.school_id = public.current_user_school_id()
    )
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW')
  );

create policy "academic_workflow_periods_select" on public.academic_workflow_periods
  for select to authenticated
  using (school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW'));

revoke insert, update, delete on table public.grading_schemes from anon, authenticated;
revoke insert, update, delete on table public.grading_scheme_bands from anon, authenticated;
revoke insert, update, delete on table public.assessment_types from anon, authenticated;
revoke insert, update, delete on table public.assessment_weight_schemes from anon, authenticated;
revoke insert, update, delete on table public.assessment_weight_items from anon, authenticated;
revoke insert, update, delete on table public.academic_workflow_periods from anon, authenticated;

grant select on table public.grading_schemes to authenticated;
grant select on table public.grading_scheme_bands to authenticated;
grant select on table public.assessment_types to authenticated;
grant select on table public.assessment_weight_schemes to authenticated;
grant select on table public.assessment_weight_items to authenticated;
grant select on table public.academic_workflow_periods to authenticated;

-- Validate bands: no overlap, contiguous optional for percentage (enforced in RPC)
create or replace function public.save_grading_scheme(
  p_id uuid,
  p_name text,
  p_bands jsonb,
  p_make_default boolean default true,
  p_confirm boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_id uuid;
  v_band jsonb;
  v_min numeric;
  v_max numeric;
  v_codes text[] := '{}';
  v_code text;
begin
  perform public.require_academic_capability('GRADING_SCHEMES_MANAGE');
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Grading scale name is required.';
  end if;
  if jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) < 1 then
    raise exception 'At least one grade band is required.';
  end if;

  -- Validate bands: ranges, duplicate codes, overlaps (inclusive)
  for v_band in select value from jsonb_array_elements(p_bands)
  loop
    v_min := (v_band->>'minimum_score')::numeric;
    v_max := (v_band->>'maximum_score')::numeric;
    v_code := upper(btrim(coalesce(v_band->>'grade_code', '')));
    if v_code = '' or btrim(coalesce(v_band->>'grade_label', '')) = '' then
      raise exception 'Each band needs a grade code and label.';
    end if;
    if v_min > v_max then
      raise exception 'Minimum score cannot be greater than maximum score.';
    end if;
    if v_code = any (v_codes) then
      raise exception 'Duplicate grade code: %', v_code;
    end if;
    v_codes := array_append(v_codes, v_code);
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_bands) a,
         jsonb_array_elements(p_bands) b
    where a <> b
      and (a->>'minimum_score')::numeric <= (b->>'maximum_score')::numeric
      and (b->>'minimum_score')::numeric <= (a->>'maximum_score')::numeric
  ) then
    raise exception 'Grade bands overlap. Adjust the ranges so they do not overlap.';
  end if;

  if p_id is null then
    if p_make_default then
      update public.grading_schemes
      set is_default = false, updated_at = now()
      where school_id = v_school and is_default;
    end if;
    insert into public.grading_schemes (
      school_id, name, scheme_type, is_default, is_active, created_by
    ) values (
      v_school, btrim(p_name), 'PERCENTAGE_BANDS',
      coalesce(p_make_default, true), true, auth.uid()
    )
    returning id into v_id;
    perform public.log_academic_event('GRADING_SCHEME_CREATED', 'grading_scheme', v_id,
      jsonb_build_object('name', btrim(p_name)));
  else
    update public.grading_schemes
    set name = btrim(p_name),
        is_default = case when p_make_default then true else is_default end,
        updated_at = now()
    where id = p_id and school_id = v_school and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'Grading scale not found.';
    end if;
    if p_make_default then
      update public.grading_schemes
      set is_default = (id = v_id), updated_at = now()
      where school_id = v_school and archived_at is null;
    end if;
    delete from public.grading_scheme_bands where grading_scheme_id = v_id;
    perform public.log_academic_event('GRADING_SCHEME_UPDATED', 'grading_scheme', v_id,
      jsonb_build_object('name', btrim(p_name)));
  end if;

  insert into public.grading_scheme_bands (
    grading_scheme_id, minimum_score, maximum_score, grade_code, grade_label,
    grade_point, performance_description, is_pass, display_order
  )
  select
    v_id,
    (b->>'minimum_score')::numeric,
    (b->>'maximum_score')::numeric,
    upper(btrim(b->>'grade_code')),
    btrim(b->>'grade_label'),
    nullif(b->>'grade_point', '')::numeric,
    nullif(btrim(coalesce(b->>'performance_description', '')), ''),
    coalesce((b->>'is_pass')::boolean, true),
    coalesce((b->>'display_order')::int, ord)
  from jsonb_array_elements(p_bands) with ordinality as t(b, ord);

  if p_confirm then
    insert into public.academic_settings (school_id, grading_scale_confirmed_at, grading_scale_confirmed_by)
    values (v_school, now(), auth.uid())
    on conflict (school_id) do update
      set grading_scale_confirmed_at = now(),
          grading_scale_confirmed_by = auth.uid(),
          updated_at = now();
    perform public.log_academic_event('GRADING_SCHEME_ACTIVATED', 'grading_scheme', v_id,
      jsonb_build_object('confirmed', true));
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_grading_scheme(uuid, text, jsonb, boolean, boolean) from public;
grant execute on function public.save_grading_scheme(uuid, text, jsonb, boolean, boolean) to authenticated;

create or replace function public.seed_default_assessment_types()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_count int := 0;
begin
  perform public.require_academic_capability('ASSESSMENT_TYPES_MANAGE');

  insert into public.assessment_types (
    school_id, name, code, category, default_maximum_mark, is_exam, display_order, created_by
  )
  select v_school, v.name, v.code, v.category, v.max_mark, v.is_exam, v.display_order, auth.uid()
  from (values
    ('Assignment', 'ASSIGNMENT', 'CONTINUOUS', 10::numeric, false, 1),
    ('Quiz', 'QUIZ', 'CONTINUOUS', 10::numeric, false, 2),
    ('Test', 'TEST', 'CONTINUOUS', 20::numeric, false, 3),
    ('Project', 'PROJECT', 'CONTINUOUS', 20::numeric, false, 4),
    ('Practical', 'PRACTICAL', 'CONTINUOUS', 20::numeric, true, 5),
    ('Mid-Term Examination', 'MIDTERM', 'EXAM', 30::numeric, true, 6),
    ('End-of-Term Examination', 'ENDTERM', 'EXAM', 40::numeric, true, 7),
    ('Final Examination', 'FINAL', 'EXAM', 40::numeric, true, 8)
  ) as v(name, code, category, max_mark, is_exam, display_order)
  where not exists (
    select 1 from public.assessment_types t
    where t.school_id = v_school and lower(t.name) = lower(v.name)
  );

  get diagnostics v_count = row_count;

  perform public.log_academic_event(
    'ASSESSMENT_TYPE_CREATED',
    'assessment_type',
    null,
    jsonb_build_object('seeded_count', v_count)
  );

  return v_count;
end;
$$;

revoke all on function public.seed_default_assessment_types() from public;
grant execute on function public.seed_default_assessment_types() to authenticated;

create or replace function public.save_weight_scheme(
  p_id uuid,
  p_name text,
  p_items jsonb,
  p_make_default boolean default true,
  p_confirm boolean default false,
  p_academic_year_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_id uuid;
  v_total numeric;
begin
  perform public.require_academic_capability('ASSESSMENT_WEIGHTS_MANAGE');
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Weight scheme name is required.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'At least one weight line is required.';
  end if;

  select coalesce(sum((i->>'weight_percentage')::numeric), 0) into v_total
  from jsonb_array_elements(p_items) i;

  if v_total <> 100 then
    raise exception 'Assessment weights must total exactly 100%% (currently %).', v_total;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) i
    group by i->>'assessment_type_id'
    having count(*) > 1
  ) then
    raise exception 'Each assessment type may appear only once in a weight scheme.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) i
    where (i->>'weight_percentage')::numeric < 0
       or (i->>'weight_percentage')::numeric > 100
  ) then
    raise exception 'Weights must be between 0 and 100.';
  end if;

  if p_id is null then
    if p_make_default then
      update public.assessment_weight_schemes
      set is_default = false, updated_at = now()
      where school_id = v_school and is_default;
    end if;
    insert into public.assessment_weight_schemes (
      school_id, name, academic_year_id, is_default, is_active, created_by
    ) values (
      v_school, btrim(p_name), p_academic_year_id,
      coalesce(p_make_default, true), true, auth.uid()
    )
    returning id into v_id;
    perform public.log_academic_event('WEIGHT_SCHEME_CREATED', 'weight_scheme', v_id,
      jsonb_build_object('name', btrim(p_name), 'total', v_total));
  else
    update public.assessment_weight_schemes
    set name = btrim(p_name),
        academic_year_id = coalesce(p_academic_year_id, academic_year_id),
        updated_at = now()
    where id = p_id and school_id = v_school
    returning id into v_id;
    if v_id is null then
      raise exception 'Weight scheme not found.';
    end if;
    if p_make_default then
      update public.assessment_weight_schemes
      set is_default = (id = v_id), updated_at = now()
      where school_id = v_school;
    end if;
    delete from public.assessment_weight_items where scheme_id = v_id;
    perform public.log_academic_event('WEIGHT_SCHEME_UPDATED', 'weight_scheme', v_id,
      jsonb_build_object('name', btrim(p_name), 'total', v_total));
  end if;

  insert into public.assessment_weight_items (
    scheme_id, assessment_type_id, weight_percentage, display_order
  )
  select
    v_id,
    (i->>'assessment_type_id')::uuid,
    (i->>'weight_percentage')::numeric,
    coalesce((i->>'display_order')::int, ord)
  from jsonb_array_elements(p_items) with ordinality as t(i, ord);

  if p_confirm then
    insert into public.academic_settings (school_id, weight_scheme_confirmed_at, weight_scheme_confirmed_by)
    values (v_school, now(), auth.uid())
    on conflict (school_id) do update
      set weight_scheme_confirmed_at = now(),
          weight_scheme_confirmed_by = auth.uid(),
          updated_at = now();
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_weight_scheme(uuid, text, jsonb, boolean, boolean, uuid) from public;
grant execute on function public.save_weight_scheme(uuid, text, jsonb, boolean, boolean, uuid) to authenticated;

create or replace function public.upsert_workflow_period(
  p_academic_year_id uuid,
  p_term_id uuid,
  p_workflow_type text,
  p_starts_at date,
  p_ends_at date default null,
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
  v_type text := upper(btrim(coalesce(p_workflow_type, '')));
begin
  perform public.require_academic_capability('ACADEMIC_CALENDAR_MANAGE');
  if v_type not in ('MARKS_ENTRY', 'MODERATION', 'APPROVAL', 'PUBLICATION') then
    raise exception 'Unknown academic date type.';
  end if;
  if p_starts_at is null then
    raise exception 'Start date is required.';
  end if;

  update public.academic_workflow_periods
  set is_active = false, updated_at = now()
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_term_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and workflow_type = v_type
    and is_active;

  insert into public.academic_workflow_periods (
    school_id, academic_year_id, term_id, workflow_type,
    starts_at, ends_at, notes, created_by
  ) values (
    v_school, p_academic_year_id, p_term_id, v_type,
    p_starts_at, p_ends_at, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  )
  returning id into v_id;

  perform public.log_academic_event(
    'ACADEMIC_WORKFLOW_PERIOD_UPDATED', 'workflow_period', v_id,
    jsonb_build_object(
      'workflow_type', v_type,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'academic_year_id', p_academic_year_id,
      'term_id', p_term_id
    )
  );
  return v_id;
end;
$$;

revoke all on function public.upsert_workflow_period(uuid, uuid, text, date, date, text) from public;
grant execute on function public.upsert_workflow_period(uuid, uuid, text, date, date, text) to authenticated;
