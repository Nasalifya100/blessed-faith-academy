-- ===========================================================================
-- Phase 9a: School rules catalogue + discipline incidents
--
-- school_rules:          reference list staff can read (and office can edit)
-- discipline_incidents:  logged behavioural / discipline events per student
--
-- Who can do what:
--   * All school staff: read rules and incidents
--   * Admin / headteacher: manage (edit) rules
--   * Admin / headteacher / secretary / teacher: record incidents
--   * Admin / headteacher / secretary: update / resolve incidents
-- ===========================================================================

create type public.discipline_severity as enum (
  'low',
  'medium',
  'high'
);

create type public.discipline_status as enum (
  'open',
  'resolved'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_school_rules()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role in ('administrator', 'headteacher')
  );
$$;

create or replace function public.can_record_discipline()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role in ('administrator', 'headteacher', 'secretary', 'teacher')
  );
$$;

create or replace function public.can_manage_discipline()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role in ('administrator', 'headteacher', 'secretary')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. school_rules
-- ---------------------------------------------------------------------------
create table public.school_rules (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete restrict,
  title       text not null,
  body        text not null default '',
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index school_rules_school_idx
  on public.school_rules (school_id, sort_order);

create trigger school_rules_set_updated_at
before update on public.school_rules
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. discipline_incidents
-- ---------------------------------------------------------------------------
create table public.discipline_incidents (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete restrict,
  student_id      uuid not null references public.students(id) on delete cascade,
  incident_date   date not null default current_date,
  title           text not null,
  description     text not null default '',
  action_taken    text not null default '',
  severity        public.discipline_severity not null default 'low',
  status          public.discipline_status not null default 'open',
  related_rule_id uuid references public.school_rules(id) on delete set null,
  recorded_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index discipline_incidents_student_idx
  on public.discipline_incidents (student_id, incident_date desc);

create index discipline_incidents_school_status_idx
  on public.discipline_incidents (school_id, status);

create trigger discipline_incidents_set_updated_at
before update on public.discipline_incidents
for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.school_rules          enable row level security;
alter table public.discipline_incidents  enable row level security;

-- Rules: all staff read; admin/headteacher write
create policy "school_rules_select" on public.school_rules
  for select to authenticated
  using (school_id = public.current_user_school_id());

create policy "school_rules_insert" on public.school_rules
  for insert to authenticated
  with check (
    public.can_manage_school_rules()
    and school_id = public.current_user_school_id()
  );

create policy "school_rules_update" on public.school_rules
  for update to authenticated
  using (
    public.can_manage_school_rules()
    and school_id = public.current_user_school_id()
  )
  with check (
    public.can_manage_school_rules()
    and school_id = public.current_user_school_id()
  );

create policy "school_rules_delete" on public.school_rules
  for delete to authenticated
  using (
    public.can_manage_school_rules()
    and school_id = public.current_user_school_id()
  );

-- Incidents: all staff read; recorders insert; managers update/delete
create policy "discipline_incidents_select" on public.discipline_incidents
  for select to authenticated
  using (school_id = public.current_user_school_id());

create policy "discipline_incidents_insert" on public.discipline_incidents
  for insert to authenticated
  with check (
    public.can_record_discipline()
    and school_id = public.current_user_school_id()
  );

create policy "discipline_incidents_update" on public.discipline_incidents
  for update to authenticated
  using (
    public.can_manage_discipline()
    and school_id = public.current_user_school_id()
  )
  with check (
    public.can_manage_discipline()
    and school_id = public.current_user_school_id()
  );

create policy "discipline_incidents_delete" on public.discipline_incidents
  for delete to authenticated
  using (
    public.can_manage_discipline()
    and school_id = public.current_user_school_id()
  );

-- ---------------------------------------------------------------------------
-- create_discipline_incident
-- ---------------------------------------------------------------------------
create or replace function public.create_discipline_incident(
  p_student_id      uuid,
  p_title           text,
  p_description     text default '',
  p_action_taken    text default '',
  p_severity        public.discipline_severity default 'low',
  p_incident_date   date default current_date,
  p_related_rule_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_id        uuid;
begin
  if not public.can_record_discipline() then
    raise exception 'You are not authorized to record discipline incidents.';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'Incident title is required.';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.school_id = v_school_id
  ) then
    raise exception 'Student was not found.';
  end if;

  if p_related_rule_id is not null and not exists (
    select 1 from public.school_rules r
    where r.id = p_related_rule_id
      and r.school_id = v_school_id
      and r.is_active
  ) then
    raise exception 'Related school rule was not found.';
  end if;

  insert into public.discipline_incidents (
    school_id, student_id, incident_date, title, description,
    action_taken, severity, related_rule_id, recorded_by
  ) values (
    v_school_id, p_student_id, coalesce(p_incident_date, current_date),
    trim(p_title), coalesce(p_description, ''), coalesce(p_action_taken, ''),
    coalesce(p_severity, 'low'), p_related_rule_id, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_discipline_incident
-- ---------------------------------------------------------------------------
create or replace function public.resolve_discipline_incident(
  p_incident_id uuid,
  p_action_taken text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.can_manage_discipline() then
    raise exception 'You are not authorized to resolve discipline incidents.';
  end if;

  update public.discipline_incidents
  set status = 'resolved',
      resolved_at = now(),
      resolved_by = auth.uid(),
      action_taken = case
        when p_action_taken is not null and trim(p_action_taken) <> ''
          then trim(p_action_taken)
        else action_taken
      end
  where id = p_incident_id
    and school_id = public.current_user_school_id()
    and status = 'open';

  if not found then
    raise exception 'Incident was not found or is already resolved.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed starter rules (editable later in the app)
-- Matches any school that has no rules yet (name-independent).
-- ---------------------------------------------------------------------------
insert into public.school_rules (school_id, title, body, sort_order)
select s.id, r.title, r.body, r.sort_order
from public.schools s
cross join (values
  (
    'Punctuality',
    'Pupils must arrive at school on time and attend all lessons unless excused.',
    10
  ),
  (
    'School uniform',
    'The correct school uniform must be worn on all school days as directed by the school.',
    20
  ),
  (
    'Respect',
    'Pupils must show respect to teachers, staff, visitors, and fellow pupils at all times.',
    30
  ),
  (
    'Behaviour in class',
    'Pupils must listen to teachers, complete assigned work, and not disrupt lessons.',
    40
  ),
  (
    'Care of property',
    'School property and the belongings of others must be treated with care. Damage or theft will be taken seriously.',
    50
  ),
  (
    'Safety',
    'Pupils must follow safety instructions and must not leave the school grounds without permission.',
    60
  ),
  (
    'Discipline',
    'Pupils who break school rules may face appropriate disciplinary action as decided by the school.',
    70
  )
) as r(title, body, sort_order)
where not exists (
  select 1 from public.school_rules sr where sr.school_id = s.id
);
