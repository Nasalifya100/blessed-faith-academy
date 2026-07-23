-- ===========================================================================
-- Phase 2A.1 — Class stream support
-- Relax one-class-per-grade uniqueness so Grade 7A / 7B can coexist.
-- Existing classes keep working without requiring a stream code.
-- ===========================================================================

-- Optional short stream/section label (A, B, C…). Null is fine for single classes.
alter table public.classes
  add column if not exists stream_code text;

comment on column public.classes.stream_code is
  'Optional stream/section code (e.g. A, B). Null for single-class grades.';

-- Drop the restrictive unique (year, grade) if present.
alter table public.classes
  drop constraint if exists classes_academic_year_id_grade_level_id_key;

-- Prevent duplicate class labels within the same grade + year (case-insensitive).
create unique index if not exists classes_year_grade_name_uidx
  on public.classes (academic_year_id, grade_level_id, lower(btrim(name)));

-- Optional: when stream_code is set, keep it unique within year+grade (NULLs allowed multiple).
create unique index if not exists classes_year_grade_stream_uidx
  on public.classes (academic_year_id, grade_level_id, lower(btrim(stream_code)))
  where stream_code is not null and btrim(stream_code) <> '';

create or replace function public.create_class(
  p_grade_level_id uuid,
  p_academic_year_id uuid,
  p_name text,
  p_stream_code text default null,
  p_capacity int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_school uuid := public.current_user_school_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_stream text := nullif(btrim(coalesce(p_stream_code, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.require_academic_capability('ACADEMIC_SETTINGS_MANAGE');
  if v_school is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if v_name = '' then
    raise exception 'Class name is required.';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise exception 'Capacity must be greater than zero when provided.';
  end if;

  if not exists (
    select 1 from public.grade_levels gl
    where gl.id = p_grade_level_id and gl.school_id = v_school
  ) then
    raise exception 'Grade not found in your school.';
  end if;

  if not exists (
    select 1 from public.academic_years ay
    where ay.id = p_academic_year_id and ay.school_id = v_school
  ) then
    raise exception 'Academic year not found in your school.';
  end if;

  insert into public.classes (
    school_id, grade_level_id, academic_year_id, name, stream_code, capacity
  ) values (
    v_school, p_grade_level_id, p_academic_year_id, v_name, v_stream, p_capacity
  )
  returning id into v_id;

  perform public.log_academic_event(
    'CLASS_STREAM_CREATED',
    'class',
    v_id,
    jsonb_build_object(
      'name', v_name,
      'stream_code', v_stream,
      'grade_level_id', p_grade_level_id,
      'academic_year_id', p_academic_year_id
    )
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'A class with this name or stream already exists for that grade and year.';
end;
$$;

revoke all on function public.create_class(uuid, uuid, text, text, int) from public;
grant execute on function public.create_class(uuid, uuid, text, text, int) to authenticated;

create or replace function public.update_class(
  p_class_id uuid,
  p_name text,
  p_stream_code text default null,
  p_capacity int default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_school uuid := public.current_user_school_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_stream text := nullif(btrim(coalesce(p_stream_code, '')), '');
  v_old public.classes%rowtype;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.require_academic_capability('ACADEMIC_SETTINGS_MANAGE');

  select * into v_old
  from public.classes
  where id = p_class_id and school_id = v_school
  for update;

  if not found then
    raise exception 'Class not found.';
  end if;
  if v_name = '' then
    raise exception 'Class name is required.';
  end if;

  update public.classes
  set
    name = v_name,
    stream_code = v_stream,
    capacity = coalesce(p_capacity, capacity),
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_class_id;

  perform public.log_academic_event(
    'CLASS_STREAM_UPDATED',
    'class',
    p_class_id,
    jsonb_build_object(
      'previous_name', v_old.name,
      'name', v_name,
      'previous_stream_code', v_old.stream_code,
      'stream_code', v_stream,
      'is_active', coalesce(p_is_active, v_old.is_active)
    )
  );
exception
  when unique_violation then
    raise exception 'A class with this name or stream already exists for that grade and year.';
end;
$$;

revoke all on function public.update_class(uuid, text, text, int, boolean) from public;
grant execute on function public.update_class(uuid, text, text, int, boolean) to authenticated;
