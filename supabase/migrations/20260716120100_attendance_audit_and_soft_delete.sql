-- ===========================================================================
-- Sprint 3: Attendance audit + soft-delete hardening (M8, M9)
--
-- File: 20260716120100_attendance_audit_and_soft_delete.sql
--
-- M8 — Log prior attendance mark when status/notes are corrected
-- M9 — Revoke hard DELETE on attendance, covers, rules, incidents;
--      keep deactivated rules linked to past incidents (ON DELETE RESTRICT)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- M8: attendance_record_audits
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_record_audits (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete restrict,
  attendance_record_id uuid not null references public.attendance_records(id) on delete restrict,
  class_id             uuid not null references public.classes(id) on delete restrict,
  student_id           uuid not null references public.students(id) on delete cascade,
  attendance_date      date not null,
  old_status           public.attendance_status not null,
  new_status           public.attendance_status not null,
  old_notes            text not null default '',
  new_notes            text not null default '',
  old_recorded_by      uuid references public.profiles(id) on delete set null,
  changed_by           uuid references public.profiles(id) on delete set null,
  changed_at           timestamptz not null default now()
);

create index if not exists attendance_record_audits_record_idx
  on public.attendance_record_audits (attendance_record_id, changed_at desc);

create index if not exists attendance_record_audits_student_idx
  on public.attendance_record_audits (student_id, changed_at desc);

create index if not exists attendance_record_audits_school_idx
  on public.attendance_record_audits (school_id, changed_at desc);

comment on table public.attendance_record_audits is
  'Append-only history of attendance corrections (previous status/notes + actor).';

alter table public.attendance_record_audits enable row level security;

drop policy if exists "attendance_record_audits_select" on public.attendance_record_audits;
create policy "attendance_record_audits_select"
  on public.attendance_record_audits for select to authenticated
  using (school_id = public.current_user_school_id());

-- No insert/update/delete policies for authenticated — writes only via trigger.

revoke insert, update, delete on table public.attendance_record_audits from anon, authenticated;
grant select on table public.attendance_record_audits to authenticated;

create or replace function public.log_attendance_record_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status is not distinct from new.status
     and coalesce(old.notes, '') is not distinct from coalesce(new.notes, '') then
    return new;
  end if;

  insert into public.attendance_record_audits (
    school_id,
    attendance_record_id,
    class_id,
    student_id,
    attendance_date,
    old_status,
    new_status,
    old_notes,
    new_notes,
    old_recorded_by,
    changed_by
  ) values (
    new.school_id,
    new.id,
    new.class_id,
    new.student_id,
    new.attendance_date,
    old.status,
    new.status,
    coalesce(old.notes, ''),
    coalesce(new.notes, ''),
    old.recorded_by,
    auth.uid()
  );

  return new;
end;
$$;

comment on function public.log_attendance_record_correction() is
  'Writes an audit row when attendance status or notes change.';

drop trigger if exists attendance_records_log_correction on public.attendance_records;
create trigger attendance_records_log_correction
after update on public.attendance_records
for each row
execute function public.log_attendance_record_correction();

-- ---------------------------------------------------------------------------
-- M9: Revoke hard DELETE (prefer soft archive / deactivate)
-- ---------------------------------------------------------------------------
drop policy if exists "attendance_records_delete" on public.attendance_records;
drop policy if exists "class_attendance_covers_delete" on public.class_attendance_covers;
drop policy if exists "school_rules_delete" on public.school_rules;
drop policy if exists "discipline_incidents_delete" on public.discipline_incidents;

revoke delete on table public.attendance_records from anon, authenticated;
revoke delete on table public.class_attendance_covers from anon, authenticated;
revoke delete on table public.school_rules from anon, authenticated;
revoke delete on table public.discipline_incidents from anon, authenticated;

-- Past incidents must keep their related rule text readable; do not SET NULL on delete.
alter table public.discipline_incidents
  drop constraint if exists discipline_incidents_related_rule_id_fkey;

alter table public.discipline_incidents
  add constraint discipline_incidents_related_rule_id_fkey
  foreign key (related_rule_id)
  references public.school_rules(id)
  on delete restrict;

comment on constraint discipline_incidents_related_rule_id_fkey on public.discipline_incidents is
  'Rules must be deactivated (is_active=false), not hard-deleted, while linked to incidents.';
