-- ===========================================================================
-- Password reset audit history (append-only)
--
-- Product policy: only Administrators initiate password resets (Staff UI).
-- Staff complete the emailed link at /auth/reset-password.
-- Self-service /forgot-password is not offered.
-- Never stores passwords, tokens, or service-role material.
-- ===========================================================================

create table if not exists public.password_reset_audits (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid references public.schools(id) on delete restrict,
  target_user_id      uuid,
  target_profile_id   uuid references public.profiles(id) on delete set null,
  target_email_masked text not null,
  action_type         text not null,
  initiated_by        uuid references public.profiles(id) on delete set null,
  result_status       text not null,
  failure_category    text,
  created_at          timestamptz not null default now(),

  constraint password_reset_audits_action_type_check
    check (action_type in (
      'self_service_reset_requested',
      'admin_reset_email_requested',
      'temporary_password_assigned',
      'password_changed'
    )),

  constraint password_reset_audits_result_status_check
    check (result_status in ('success', 'failure', 'accepted'))
);

create index if not exists password_reset_audits_created_idx
  on public.password_reset_audits (created_at desc);

create index if not exists password_reset_audits_target_profile_idx
  on public.password_reset_audits (target_profile_id, created_at desc);

create index if not exists password_reset_audits_school_idx
  on public.password_reset_audits (school_id, created_at desc);

create index if not exists password_reset_audits_initiated_by_idx
  on public.password_reset_audits (initiated_by, created_at desc);

comment on table public.password_reset_audits is
  'Append-only password-reset events. No passwords or tokens stored.';

alter table public.password_reset_audits enable row level security;

drop policy if exists "password_reset_audits_select" on public.password_reset_audits;
create policy "password_reset_audits_select"
  on public.password_reset_audits
  for select
  to authenticated
  using (
    public.is_administrator()
    and (
      school_id is null
      or school_id = public.current_user_school_id()
    )
  );

revoke insert, update, delete on table public.password_reset_audits
  from anon, authenticated;
grant select on table public.password_reset_audits to authenticated;

create or replace function public.mask_email_for_audit(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_at integer;
  v_local text;
  v_domain text;
begin
  if v_email = '' then
    return 'unknown';
  end if;

  v_at := position('@' in v_email);
  if v_at < 2 then
    return '***';
  end if;

  v_local := left(v_email, v_at - 1);
  v_domain := substr(v_email, v_at + 1);

  if length(v_local) <= 2 then
    return left(v_local, 1) || '*@' || v_domain;
  end if;

  return left(v_local, 1) || '***' || right(v_local, 1) || '@' || v_domain;
end;
$$;

create or replace function public.log_password_reset_event(
  p_target_user_id uuid,
  p_target_profile_id uuid,
  p_target_email text,
  p_action_type text,
  p_initiated_by uuid,
  p_result_status text,
  p_failure_category text default null,
  p_school_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_school uuid := p_school_id;
begin
  if p_action_type not in (
    'self_service_reset_requested',
    'admin_reset_email_requested',
    'temporary_password_assigned',
    'password_changed'
  ) then
    raise exception 'Invalid password reset action type.';
  end if;

  if p_result_status not in ('success', 'failure', 'accepted') then
    raise exception 'Invalid password reset result status.';
  end if;

  -- Never accept credential-like payloads in failure_category.
  if p_failure_category is not null and (
    lower(p_failure_category) like '%password%'
    or lower(p_failure_category) like '%token%'
    or lower(p_failure_category) like '%secret%'
    or lower(p_failure_category) like '%bearer%'
  ) then
    p_failure_category := 'sanitized_failure';
  end if;

  if v_school is null and p_target_profile_id is not null then
    select school_id into v_school
    from public.profiles
    where id = p_target_profile_id;
  end if;

  if v_school is null and p_initiated_by is not null then
    select school_id into v_school
    from public.profiles
    where id = p_initiated_by;
  end if;

  insert into public.password_reset_audits (
    school_id,
    target_user_id,
    target_profile_id,
    target_email_masked,
    action_type,
    initiated_by,
    result_status,
    failure_category
  ) values (
    v_school,
    p_target_user_id,
    p_target_profile_id,
    public.mask_email_for_audit(p_target_email),
    p_action_type,
    p_initiated_by,
    p_result_status,
    nullif(btrim(coalesce(p_failure_category, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_password_reset_event is
  'Trusted insert for password-reset audit rows. Masks email; never stores secrets.';

revoke all on function public.log_password_reset_event(
  uuid, uuid, text, text, uuid, text, text, uuid
) from public, anon;
grant execute on function public.log_password_reset_event(
  uuid, uuid, text, text, uuid, text, text, uuid
) to authenticated, service_role;
