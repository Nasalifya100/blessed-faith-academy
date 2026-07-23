-- ===========================================================================
-- Phase 2A.0 — Academic audit stream + capability helpers
-- Must run before academic configuration RPCs that call log_academic_event.
-- ===========================================================================

create table if not exists public.academic_event_audits (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools(id) on delete restrict,
  event_type   text not null,
  entity_type  text,
  entity_id    uuid,
  actor_id     uuid references public.profiles(id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists academic_event_audits_school_created_idx
  on public.academic_event_audits (school_id, created_at desc);

create index if not exists academic_event_audits_entity_idx
  on public.academic_event_audits (entity_type, entity_id, created_at desc);

comment on table public.academic_event_audits is
  'Append-only academic configuration and results audit. No secrets/tokens.';

alter table public.academic_event_audits enable row level security;

drop policy if exists "academic_event_audits_select" on public.academic_event_audits;
create policy "academic_event_audits_select"
  on public.academic_event_audits
  for select
  to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.is_administrator()
      or public.current_user_role() = 'headteacher'::public.staff_role
    )
  );

revoke insert, update, delete on table public.academic_event_audits
  from anon, authenticated;
grant select on table public.academic_event_audits to authenticated;

-- Capability grants (optional overrides / future fine-grained roles)
create table if not exists public.academic_capabilities (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  capability   text not null,
  is_active    boolean not null default true,
  granted_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (profile_id, capability)
);

create index if not exists academic_capabilities_school_idx
  on public.academic_capabilities (school_id, capability)
  where is_active;

alter table public.academic_capabilities enable row level security;

drop policy if exists "academic_capabilities_select" on public.academic_capabilities;
create policy "academic_capabilities_select"
  on public.academic_capabilities
  for select
  to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.is_administrator()
      or profile_id = auth.uid()
    )
  );

revoke insert, update, delete on table public.academic_capabilities
  from anon, authenticated;
grant select on table public.academic_capabilities to authenticated;

create table if not exists public.academic_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  grading_scale_confirmed_at timestamptz,
  grading_scale_confirmed_by uuid references public.profiles(id) on delete set null,
  weight_scheme_confirmed_at timestamptz,
  weight_scheme_confirmed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.academic_settings enable row level security;

drop policy if exists "academic_settings_select" on public.academic_settings;
create policy "academic_settings_select"
  on public.academic_settings
  for select
  to authenticated
  using (school_id = public.current_user_school_id());

revoke insert, update, delete on table public.academic_settings
  from anon, authenticated;
grant select on table public.academic_settings to authenticated;

create or replace function public.log_academic_event(
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_user_school_id();
begin
  insert into public.academic_event_audits (
    school_id, event_type, entity_type, entity_id, actor_id, metadata
  ) values (
    v_school,
    p_event_type,
    p_entity_type,
    p_entity_id,
    auth.uid(),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_academic_event(text, text, uuid, jsonb) from public;
grant execute on function public.log_academic_event(text, text, uuid, jsonb) to authenticated;

-- Role defaults + optional capability rows. Administrators always manage config.
create or replace function public.has_academic_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.staff_role;
  v_cap text := upper(btrim(coalesce(p_capability, '')));
begin
  if auth.uid() is null then
    return false;
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active;

  if not found then
    return false;
  end if;

  if v_role = 'administrator'::public.staff_role then
    return true;
  end if;

  -- Headteacher: view all config; manage selected areas
  if v_role = 'headteacher'::public.staff_role then
    if v_cap in (
      'ACADEMIC_CONFIGURATION_VIEW',
      'SUBJECTS_MANAGE',
      'SUBJECT_OFFERINGS_MANAGE',
      'TEACHING_ASSIGNMENTS_MANAGE',
      'GRADING_SCHEMES_MANAGE',
      'ASSESSMENT_TYPES_MANAGE',
      'ASSESSMENT_WEIGHTS_MANAGE',
      'ACADEMIC_CALENDAR_MANAGE',
      'ACADEMIC_SETTINGS_MANAGE'
    ) then
      return true;
    end if;
  end if;

  -- Teachers / others: view-only for relevant config by default
  if v_cap = 'ACADEMIC_CONFIGURATION_VIEW' then
    return v_role in (
      'teacher'::public.staff_role,
      'secretary'::public.staff_role,
      'bursar'::public.staff_role,
      'headteacher'::public.staff_role
    );
  end if;

  return exists (
    select 1
    from public.academic_capabilities c
    where c.profile_id = auth.uid()
      and c.capability = v_cap
      and c.is_active
      and c.school_id = public.current_user_school_id()
  );
end;
$$;

revoke all on function public.has_academic_capability(text) from public;
grant execute on function public.has_academic_capability(text) to authenticated;

create or replace function public.require_academic_capability(p_capability text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.has_academic_capability(p_capability) then
    raise exception 'You are not authorized to perform this academic configuration action.';
  end if;
end;
$$;

revoke all on function public.require_academic_capability(text) from public;
grant execute on function public.require_academic_capability(text) to authenticated;
