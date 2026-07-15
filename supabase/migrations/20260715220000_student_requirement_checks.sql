-- ===========================================================================
-- Phase 7b: Per-student requirements checklist (what parents brought)
--
-- Catalogue stays in requirement_items (not money).
-- This table records whether each item was received for a student/year.
-- ===========================================================================

create table public.student_requirement_checks (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete restrict,
  student_id           uuid not null references public.students(id) on delete cascade,
  requirement_item_id  uuid not null references public.requirement_items(id) on delete restrict,
  academic_year_id     uuid not null references public.academic_years(id) on delete restrict,
  is_received          boolean not null default false,
  received_on          date,
  notes                text not null default '',
  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (student_id, requirement_item_id, academic_year_id)
);

create index student_requirement_checks_student_idx
  on public.student_requirement_checks (student_id, academic_year_id);

create trigger student_requirement_checks_set_updated_at
before update on public.student_requirement_checks
for each row execute function public.set_updated_at();

alter table public.student_requirement_checks enable row level security;

create policy "student_requirement_checks_select"
  on public.student_requirement_checks for select to authenticated
  using (school_id = public.current_user_school_id());

create policy "student_requirement_checks_insert"
  on public.student_requirement_checks for insert to authenticated
  with check (
    school_id = public.current_user_school_id()
    and (public.can_manage_fees() or public.can_manage_students())
  );

create policy "student_requirement_checks_update"
  on public.student_requirement_checks for update to authenticated
  using (
    school_id = public.current_user_school_id()
    and (public.can_manage_fees() or public.can_manage_students())
  )
  with check (
    school_id = public.current_user_school_id()
    and (public.can_manage_fees() or public.can_manage_students())
  );

create policy "student_requirement_checks_delete"
  on public.student_requirement_checks for delete to authenticated
  using (
    school_id = public.current_user_school_id()
    and (public.can_manage_fees() or public.can_manage_students())
  );

-- ---------------------------------------------------------------------------
-- set_requirement_received: upsert a checklist tick for the current year
-- ---------------------------------------------------------------------------
create or replace function public.set_requirement_received(
  p_student_id          uuid,
  p_requirement_item_id uuid,
  p_is_received         boolean,
  p_notes               text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_academic_year_id uuid;
  v_check_id         uuid;
begin
  if not (public.can_manage_fees() or public.can_manage_students()) then
    raise exception 'You are not authorized to update requirements.';
  end if;

  select id into v_academic_year_id
  from public.academic_years
  where school_id = v_school_id and is_current
  limit 1;

  if v_academic_year_id is null then
    raise exception 'No current academic year found.';
  end if;

  if not exists (
    select 1 from public.students
    where id = p_student_id and school_id = v_school_id
  ) then
    raise exception 'Student was not found.';
  end if;

  if not exists (
    select 1 from public.requirement_items
    where id = p_requirement_item_id
      and school_id = v_school_id
      and is_active
  ) then
    raise exception 'Requirement item was not found.';
  end if;

  insert into public.student_requirement_checks (
    school_id,
    student_id,
    requirement_item_id,
    academic_year_id,
    is_received,
    received_on,
    notes,
    updated_by
  ) values (
    v_school_id,
    p_student_id,
    p_requirement_item_id,
    v_academic_year_id,
    p_is_received,
    case when p_is_received then current_date else null end,
    coalesce(p_notes, ''),
    auth.uid()
  )
  on conflict (student_id, requirement_item_id, academic_year_id)
  do update set
    is_received = excluded.is_received,
    received_on = case
      when excluded.is_received then coalesce(
        public.student_requirement_checks.received_on,
        current_date
      )
      else null
    end,
    notes = excluded.notes,
    updated_by = auth.uid()
  returning id into v_check_id;

  return v_check_id;
end;
$$;
