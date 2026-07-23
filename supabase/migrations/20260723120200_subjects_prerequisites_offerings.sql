-- ===========================================================================
-- Phase 2A.2 — Subjects, prerequisites, subject offerings
-- ===========================================================================

do $$ begin
  create type public.subject_category as enum (
    'CORE', 'ELECTIVE', 'OPTIONAL', 'PRACTICAL', 'CO_CURRICULAR'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.subjects (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  code             text,
  name             text not null,
  short_name       text,
  description      text,
  subject_category public.subject_category not null default 'CORE',
  is_active        boolean not null default true,
  display_order    int not null default 0,
  created_by       uuid references public.profiles(id) on delete set null,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint subjects_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists subjects_school_name_uidx
  on public.subjects (school_id, lower(btrim(name)))
  where archived_at is null;

create unique index if not exists subjects_school_code_uidx
  on public.subjects (school_id, lower(btrim(code)))
  where code is not null and btrim(code) <> '' and archived_at is null;

create index if not exists subjects_school_active_idx
  on public.subjects (school_id, is_active, display_order, name);

create trigger subjects_set_updated_at
before update on public.subjects
for each row execute function public.set_updated_at();

create table if not exists public.subject_prerequisites (
  id                       uuid primary key default gen_random_uuid(),
  school_id                uuid not null references public.schools(id) on delete restrict,
  subject_id               uuid not null references public.subjects(id) on delete restrict,
  prerequisite_subject_id  uuid not null references public.subjects(id) on delete restrict,
  requirement_type         text not null default 'REQUIRED',
  notes                    text,
  is_active                boolean not null default true,
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  constraint subject_prerequisites_not_self
    check (subject_id <> prerequisite_subject_id),
  unique (subject_id, prerequisite_subject_id)
);

create table if not exists public.subject_offerings (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id          uuid references public.terms(id) on delete restrict,
  grade_level_id   uuid not null references public.grade_levels(id) on delete restrict,
  class_id         uuid references public.classes(id) on delete restrict,
  subject_id       uuid not null references public.subjects(id) on delete restrict,
  offering_type    text not null default 'GRADE_WIDE',
  is_compulsory    boolean not null default true,
  is_active        boolean not null default true,
  effective_from   date,
  effective_to     date,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint subject_offerings_type_check
    check (offering_type in ('GRADE_WIDE', 'CLASS_SPECIFIC')),
  constraint subject_offerings_dates_check
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint subject_offerings_class_scope_check
    check (
      (offering_type = 'GRADE_WIDE' and class_id is null)
      or (offering_type = 'CLASS_SPECIFIC' and class_id is not null)
    )
);

create trigger subject_offerings_set_updated_at
before update on public.subject_offerings
for each row execute function public.set_updated_at();

-- Active offerings unique by year/term/grade/class/subject
create unique index if not exists subject_offerings_active_scope_uidx
  on public.subject_offerings (
    academic_year_id,
    coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid),
    grade_level_id,
    coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    subject_id
  )
  where is_active;

-- RLS
alter table public.subjects enable row level security;
alter table public.subject_prerequisites enable row level security;
alter table public.subject_offerings enable row level security;

drop policy if exists "subjects_select" on public.subjects;
create policy "subjects_select" on public.subjects
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW')
  );

drop policy if exists "subject_prerequisites_select" on public.subject_prerequisites;
create policy "subject_prerequisites_select" on public.subject_prerequisites
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW')
  );

drop policy if exists "subject_offerings_select" on public.subject_offerings;
create policy "subject_offerings_select" on public.subject_offerings
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_academic_capability('ACADEMIC_CONFIGURATION_VIEW')
  );

revoke insert, update, delete on table public.subjects from anon, authenticated;
revoke insert, update, delete on table public.subject_prerequisites from anon, authenticated;
revoke insert, update, delete on table public.subject_offerings from anon, authenticated;
grant select on table public.subjects to authenticated;
grant select on table public.subject_prerequisites to authenticated;
grant select on table public.subject_offerings to authenticated;

-- ---------- RPCs: subjects ----------

create or replace function public.upsert_subject(
  p_id uuid,
  p_name text,
  p_short_name text default null,
  p_code text default null,
  p_category public.subject_category default 'CORE',
  p_description text default null,
  p_display_order int default 0,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_short text := nullif(btrim(coalesce(p_short_name, '')), '');
  v_id uuid;
  v_event text;
begin
  perform public.require_academic_capability('SUBJECTS_MANAGE');
  if v_school is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if v_name = '' then
    raise exception 'Subject name is required.';
  end if;

  if p_id is null then
    insert into public.subjects (
      school_id, name, short_name, code, subject_category, description,
      display_order, is_active, created_by
    ) values (
      v_school, v_name, v_short, v_code, coalesce(p_category, 'CORE'),
      nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_display_order, 0), coalesce(p_is_active, true), auth.uid()
    )
    returning id into v_id;
    v_event := 'SUBJECT_CREATED';
  else
    update public.subjects
    set
      name = v_name,
      short_name = v_short,
      code = v_code,
      subject_category = coalesce(p_category, subject_category),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      display_order = coalesce(p_display_order, display_order),
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
    where id = p_id and school_id = v_school and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'Subject not found.';
    end if;
    v_event := 'SUBJECT_UPDATED';
  end if;

  perform public.log_academic_event(
    v_event, 'subject', v_id,
    jsonb_build_object('name', v_name, 'code', v_code, 'category', p_category, 'is_active', p_is_active)
  );
  return v_id;
exception
  when unique_violation then
    raise exception 'A subject with this name or code already exists.';
end;
$$;

revoke all on function public.upsert_subject(uuid, text, text, text, public.subject_category, text, int, boolean) from public;
grant execute on function public.upsert_subject(uuid, text, text, text, public.subject_category, text, int, boolean) to authenticated;

create or replace function public.set_subject_active(
  p_subject_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
begin
  perform public.require_academic_capability('SUBJECTS_MANAGE');
  update public.subjects
  set is_active = p_is_active, updated_at = now()
  where id = p_subject_id and school_id = v_school and archived_at is null;
  if not found then
    raise exception 'Subject not found.';
  end if;
  perform public.log_academic_event(
    case when p_is_active then 'SUBJECT_UPDATED' else 'SUBJECT_DEACTIVATED' end,
    'subject', p_subject_id,
    jsonb_build_object('is_active', p_is_active)
  );
end;
$$;

revoke all on function public.set_subject_active(uuid, boolean) from public;
grant execute on function public.set_subject_active(uuid, boolean) to authenticated;

create or replace function public.add_subject_prerequisite(
  p_subject_id uuid,
  p_prerequisite_subject_id uuid,
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
  perform public.require_academic_capability('SUBJECTS_MANAGE');
  if p_subject_id = p_prerequisite_subject_id then
    raise exception 'A subject cannot require itself.';
  end if;
  if not exists (
    select 1 from public.subjects
    where id in (p_subject_id, p_prerequisite_subject_id)
      and school_id = v_school
      and archived_at is null
    having count(*) = 2
  ) then
    raise exception 'Both subjects must belong to your school.';
  end if;
  -- Block direct reverse cycle A→B and B→A
  if exists (
    select 1 from public.subject_prerequisites
    where subject_id = p_prerequisite_subject_id
      and prerequisite_subject_id = p_subject_id
      and is_active
  ) then
    raise exception 'That prerequisite would create a circular relationship.';
  end if;

  insert into public.subject_prerequisites (
    school_id, subject_id, prerequisite_subject_id, notes, created_by
  ) values (
    v_school, p_subject_id, p_prerequisite_subject_id,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  )
  returning id into v_id;

  perform public.log_academic_event(
    'SUBJECT_PREREQUISITE_ADDED', 'subject_prerequisite', v_id,
    jsonb_build_object(
      'subject_id', p_subject_id,
      'prerequisite_subject_id', p_prerequisite_subject_id
    )
  );
  return v_id;
exception
  when unique_violation then
    raise exception 'That prerequisite already exists.';
end;
$$;

revoke all on function public.add_subject_prerequisite(uuid, uuid, text) from public;
grant execute on function public.add_subject_prerequisite(uuid, uuid, text) to authenticated;

-- Bulk assign subjects to a grade (year-long, grade-wide)
create or replace function public.bulk_set_grade_subject_offerings(
  p_academic_year_id uuid,
  p_grade_level_id uuid,
  p_items jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
  v_item jsonb;
  v_subject uuid;
  v_compulsory boolean;
  v_count int := 0;
  v_id uuid;
begin
  perform public.require_academic_capability('SUBJECT_OFFERINGS_MANAGE');
  if v_school is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Offerings payload must be an array.';
  end if;

  if not exists (
    select 1 from public.academic_years
    where id = p_academic_year_id and school_id = v_school
  ) then
    raise exception 'Academic year not found.';
  end if;
  if not exists (
    select 1 from public.grade_levels
    where id = p_grade_level_id and school_id = v_school
  ) then
    raise exception 'Grade not found.';
  end if;

  -- Deactivate current year-long grade-wide offerings for this grade,
  -- then recreate from payload (simple replace for the guided UI).
  update public.subject_offerings
  set is_active = false, updated_at = now()
  where school_id = v_school
    and academic_year_id = p_academic_year_id
    and grade_level_id = p_grade_level_id
    and term_id is null
    and class_id is null
    and offering_type = 'GRADE_WIDE'
    and is_active;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_subject := (v_item->>'subject_id')::uuid;
    v_compulsory := coalesce((v_item->>'is_compulsory')::boolean, true);

    if not exists (
      select 1 from public.subjects
      where id = v_subject and school_id = v_school and is_active and archived_at is null
    ) then
      raise exception 'Inactive or unknown subject cannot be offered.';
    end if;

    insert into public.subject_offerings (
      school_id, academic_year_id, grade_level_id, subject_id,
      offering_type, is_compulsory, is_active, created_by
    ) values (
      v_school, p_academic_year_id, p_grade_level_id, v_subject,
      'GRADE_WIDE', v_compulsory, true, auth.uid()
    )
    returning id into v_id;

    perform public.log_academic_event(
      'SUBJECT_OFFERING_CREATED', 'subject_offering', v_id,
      jsonb_build_object(
        'academic_year_id', p_academic_year_id,
        'grade_level_id', p_grade_level_id,
        'subject_id', v_subject,
        'is_compulsory', v_compulsory
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.bulk_set_grade_subject_offerings(uuid, uuid, jsonb) from public;
grant execute on function public.bulk_set_grade_subject_offerings(uuid, uuid, jsonb) to authenticated;
