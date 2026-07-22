-- ===========================================================================
-- Profile Change History (production-safe)
--
-- Adds append-only student_profile_change_audits and trusted update RPCs.
-- Does NOT modify existing pupil/guardian rows, finance, attendance,
-- discipline, or enrolment data.
--
-- Architecture:
--   1. App calls update_student_profile / update_guardian_profile (SECURITY DEFINER)
--   2. RPC sets request-scoped GUCs (reason, note, actor context) then UPDATEs
--   3. AFTER UPDATE triggers write one audit row per changed tracked field
--   4. Direct UPDATEs that touch tracked fields without a reason still audit
--      with change_reason = 'system_direct' (no silent gaps)
--
-- Assumptions:
--   - Students are archived, not hard-deleted (RESTRICT keeps history)
--   - Guardians are not hard-deleted while linked (RESTRICT)
--   - One guardian may link to many students (shared record)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit table
-- ---------------------------------------------------------------------------
create table if not exists public.student_profile_change_audits (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete restrict,
  -- CASCADE only applies to privileged hard-deletes (e.g. Production Reset).
  -- Normal staff flows archive students and never hard-delete them.
  student_id    uuid not null references public.students(id) on delete cascade,
  guardian_id   uuid references public.guardians(id) on delete cascade,
  entity_type   text not null,
  field_name    text not null,
  field_label   text not null,
  old_value     text,
  new_value     text,
  change_reason text not null,
  change_note   text,
  is_sensitive  boolean not null default false,
  changed_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint student_profile_change_audits_entity_type_check
    check (entity_type in ('student', 'guardian')),

  constraint student_profile_change_audits_reason_check
    check (change_reason in (
      'typing_error',
      'parent_guardian_request',
      'official_document_update',
      'contact_information_update',
      'guardian_responsibility_change',
      'other',
      'system_direct'
    )),

  constraint student_profile_change_audits_entity_shape_check
    check (
      (entity_type = 'student' and guardian_id is null)
      or (entity_type = 'guardian' and guardian_id is not null)
    ),

  constraint student_profile_change_audits_other_note_check
    check (
      change_reason <> 'other'
      or (change_note is not null and length(btrim(change_note)) > 0)
    )
);

create index if not exists student_profile_change_audits_student_idx
  on public.student_profile_change_audits (student_id, created_at desc);

create index if not exists student_profile_change_audits_guardian_idx
  on public.student_profile_change_audits (guardian_id, created_at desc)
  where guardian_id is not null;

create index if not exists student_profile_change_audits_created_idx
  on public.student_profile_change_audits (created_at desc);

create index if not exists student_profile_change_audits_changed_by_idx
  on public.student_profile_change_audits (changed_by, created_at desc);

create index if not exists student_profile_change_audits_school_idx
  on public.student_profile_change_audits (school_id, created_at desc);

comment on table public.student_profile_change_audits is
  'Append-only pupil/guardian field corrections. Writes via trusted triggers/RPCs only.';

alter table public.student_profile_change_audits enable row level security;

drop policy if exists "student_profile_change_audits_select" on public.student_profile_change_audits;
create policy "student_profile_change_audits_select"
  on public.student_profile_change_audits for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and (
      public.is_administrator()
      or public.current_user_role() in (
        'headteacher', 'secretary', 'bursar', 'teacher'
      )
    )
  );

revoke insert, update, delete on table public.student_profile_change_audits
  from anon, authenticated;
grant select on table public.student_profile_change_audits to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers: labels, sensitivity, session context
-- ---------------------------------------------------------------------------
create or replace function public.profile_field_label(p_field text)
returns text
language sql
immutable
as $$
  select case p_field
    when 'admission_number' then 'Admission number'
    when 'first_name' then 'First name'
    when 'middle_name' then 'Middle name'
    when 'last_name' then 'Last name'
    when 'date_of_birth' then 'Date of birth'
    when 'gender' then 'Gender'
    when 'enrollment_date' then 'Enrollment date'
    when 'place_of_birth' then 'Place of birth'
    when 'religious_denomination' then 'Religious denomination'
    when 'previous_school' then 'Present / last school'
    when 'proposed_admission_date' then 'Proposed admission date'
    when 'is_zambian_citizen' then 'Zambian citizen'
    when 'medical_notes' then 'Medical notes / allergies'
    when 'vaccinated_smallpox' then 'Vaccinated (smallpox)'
    when 'vaccination_date' then 'Vaccination date'
    when 'phone' then 'Guardian phone number'
    when 'alt_phone' then 'Alternate phone'
    when 'whatsapp' then 'WhatsApp number'
    when 'email' then 'Email address'
    when 'national_id' then 'NRC / national ID'
    when 'occupation' then 'Occupation'
    when 'address' then 'Residential address'
    when 'postal_address' then 'Postal address'
    when 'relationship' then 'Relationship to pupil'
    when 'is_primary_contact' then 'Primary contact'
    when 'is_emergency_contact' then 'Emergency contact'
    else initcap(replace(p_field, '_', ' '))
  end;
$$;

create or replace function public.profile_field_is_sensitive(p_field text)
returns boolean
language sql
immutable
as $$
  select p_field in (
    'medical_notes',
    'vaccinated_smallpox',
    'vaccination_date',
    'national_id',
    'phone',
    'alt_phone',
    'whatsapp',
    'email',
    'address',
    'postal_address'
  );
$$;

create or replace function public.profile_change_text(p_value text)
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(p_value, '')), '');
$$;

create or replace function public.profile_change_bool_text(p_value boolean)
returns text
language sql
immutable
as $$
  select case
    when p_value is null then null
    when p_value then 'Yes'
    else 'No'
  end;
$$;

create or replace function public.set_profile_change_context(
  p_reason text,
  p_note text,
  p_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reason is null or p_reason not in (
    'typing_error',
    'parent_guardian_request',
    'official_document_update',
    'contact_information_update',
    'guardian_responsibility_change',
    'other',
    'system_direct'
  ) then
    raise exception 'Invalid correction reason.';
  end if;

  if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'A note is required when the reason is Other.';
  end if;

  perform set_config('bfa.profile_change_reason', p_reason, true);
  perform set_config(
    'bfa.profile_change_note',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), ''),
    true
  );
  perform set_config(
    'bfa.profile_change_student_id',
    coalesce(p_student_id::text, ''),
    true
  );
  perform set_config('bfa.profile_change_active', '1', true);
end;
$$;

create or replace function public.clear_profile_change_context()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('bfa.profile_change_active', '', true);
  perform set_config('bfa.profile_change_reason', '', true);
  perform set_config('bfa.profile_change_note', '', true);
  perform set_config('bfa.profile_change_student_id', '', true);
end;
$$;

create or replace function public.insert_profile_change_audit(
  p_school_id uuid,
  p_student_id uuid,
  p_guardian_id uuid,
  p_entity_type text,
  p_field_name text,
  p_old_value text,
  p_new_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_note text;
begin
  if public.profile_change_text(p_old_value)
     is not distinct from public.profile_change_text(p_new_value) then
    return;
  end if;

  v_reason := nullif(current_setting('bfa.profile_change_reason', true), '');
  if v_reason is null then
    v_reason := 'system_direct';
  end if;

  v_note := nullif(current_setting('bfa.profile_change_note', true), '');

  if v_reason = 'other' and v_note is null then
    v_note := 'Corrected outside the standard profile form.';
  end if;

  insert into public.student_profile_change_audits (
    school_id,
    student_id,
    guardian_id,
    entity_type,
    field_name,
    field_label,
    old_value,
    new_value,
    change_reason,
    change_note,
    is_sensitive,
    changed_by
  ) values (
    p_school_id,
    p_student_id,
    p_guardian_id,
    p_entity_type,
    p_field_name,
    public.profile_field_label(p_field_name),
    public.profile_change_text(p_old_value),
    public.profile_change_text(p_new_value),
    v_reason,
    v_note,
    public.profile_field_is_sensitive(p_field_name),
    auth.uid()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers on students / guardians / medical / link
-- ---------------------------------------------------------------------------
create or replace function public.log_student_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'admission_number',
    old.admission_number, new.admission_number
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'first_name',
    old.first_name, new.first_name
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'middle_name',
    old.middle_name, new.middle_name
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'last_name',
    old.last_name, new.last_name
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'date_of_birth',
    old.date_of_birth::text, new.date_of_birth::text
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'gender',
    old.gender::text, new.gender::text
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'enrollment_date',
    old.enrollment_date::text, new.enrollment_date::text
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'place_of_birth',
    old.place_of_birth, new.place_of_birth
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'religious_denomination',
    old.religious_denomination, new.religious_denomination
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'previous_school',
    old.previous_school, new.previous_school
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'proposed_admission_date',
    old.proposed_admission_date::text, new.proposed_admission_date::text
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.id, null, 'student', 'is_zambian_citizen',
    public.profile_change_bool_text(old.is_zambian_citizen),
    public.profile_change_bool_text(new.is_zambian_citizen)
  );

  return new;
end;
$$;

drop trigger if exists students_log_profile_changes on public.students;
create trigger students_log_profile_changes
after update on public.students
for each row
execute function public.log_student_profile_changes();

create or replace function public.log_guardian_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_context text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  v_context := nullif(current_setting('bfa.profile_change_student_id', true), '');
  if v_context is not null then
    v_student_id := v_context::uuid;
  else
    select sg.student_id
      into v_student_id
    from public.student_guardians sg
    where sg.guardian_id = new.id
    order by sg.is_primary_contact desc, sg.created_at asc
    limit 1;
  end if;

  if v_student_id is null then
    return new;
  end if;

  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'first_name',
    old.first_name, new.first_name
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'last_name',
    old.last_name, new.last_name
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'phone',
    old.phone, new.phone
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'alt_phone',
    old.alt_phone, new.alt_phone
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'whatsapp',
    old.whatsapp, new.whatsapp
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'email',
    old.email, new.email
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'national_id',
    old.national_id, new.national_id
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'occupation',
    old.occupation, new.occupation
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'address',
    old.address, new.address
  );
  perform public.insert_profile_change_audit(
    new.school_id, v_student_id, new.id, 'guardian', 'postal_address',
    old.postal_address, new.postal_address
  );

  return new;
end;
$$;

drop trigger if exists guardians_log_profile_changes on public.guardians;
create trigger guardians_log_profile_changes
after update on public.guardians
for each row
execute function public.log_guardian_profile_changes();

create or replace function public.log_student_medical_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  perform public.insert_profile_change_audit(
    new.school_id, new.student_id, null, 'student', 'medical_notes',
    old.medical_notes, new.medical_notes
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.student_id, null, 'student', 'vaccinated_smallpox',
    public.profile_change_bool_text(old.vaccinated_smallpox),
    public.profile_change_bool_text(new.vaccinated_smallpox)
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.student_id, null, 'student', 'vaccination_date',
    old.vaccination_date::text, new.vaccination_date::text
  );

  return new;
end;
$$;

drop trigger if exists student_medical_log_profile_changes on public.student_medical;
create trigger student_medical_log_profile_changes
after update on public.student_medical
for each row
execute function public.log_student_medical_profile_changes();

create or replace function public.log_student_guardian_link_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  perform public.insert_profile_change_audit(
    new.school_id, new.student_id, new.guardian_id, 'guardian', 'relationship',
    old.relationship::text, new.relationship::text
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.student_id, new.guardian_id, 'guardian',
    'is_primary_contact',
    public.profile_change_bool_text(old.is_primary_contact),
    public.profile_change_bool_text(new.is_primary_contact)
  );
  perform public.insert_profile_change_audit(
    new.school_id, new.student_id, new.guardian_id, 'guardian',
    'is_emergency_contact',
    public.profile_change_bool_text(old.is_emergency_contact),
    public.profile_change_bool_text(new.is_emergency_contact)
  );

  return new;
end;
$$;

drop trigger if exists student_guardians_log_profile_changes on public.student_guardians;
create trigger student_guardians_log_profile_changes
after update on public.student_guardians
for each row
execute function public.log_student_guardian_link_changes();

-- ---------------------------------------------------------------------------
-- 4. Trusted update RPCs (single transaction with audit via triggers)
-- ---------------------------------------------------------------------------
create or replace function public.update_student_profile(
  p_student_id uuid,
  p_admission_number text,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_date_of_birth date,
  p_gender public.gender,
  p_enrollment_date date,
  p_place_of_birth text,
  p_religious_denomination text,
  p_previous_school text,
  p_proposed_admission_date date,
  p_is_zambian_citizen boolean,
  p_medical_notes text,
  p_vaccinated_smallpox boolean,
  p_vaccination_date date,
  p_change_reason text,
  p_change_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_changed integer := 0;
  v_before public.students%rowtype;
  v_med_before public.student_medical%rowtype;
  v_med_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  if not public.can_manage_students() then
    raise exception 'Not authorized to edit pupil profiles.';
  end if;

  if p_date_of_birth is null or p_date_of_birth > current_date then
    raise exception 'Date of birth cannot be in the future.';
  end if;

  select * into v_before
  from public.students
  where id = p_student_id
    and school_id = public.current_user_school_id()
  for update;

  if not found then
    raise exception 'Student not found.';
  end if;

  v_school_id := v_before.school_id;

  perform public.set_profile_change_context(
    p_change_reason,
    p_change_note,
    p_student_id
  );

  update public.students set
    admission_number = upper(btrim(p_admission_number)),
    first_name = btrim(p_first_name),
    middle_name = nullif(btrim(coalesce(p_middle_name, '')), ''),
    last_name = btrim(p_last_name),
    date_of_birth = p_date_of_birth,
    gender = p_gender,
    enrollment_date = p_enrollment_date,
    place_of_birth = nullif(btrim(coalesce(p_place_of_birth, '')), ''),
    religious_denomination = nullif(btrim(coalesce(p_religious_denomination, '')), ''),
    previous_school = nullif(btrim(coalesce(p_previous_school, '')), ''),
    proposed_admission_date = p_proposed_admission_date,
    is_zambian_citizen = p_is_zambian_citizen
  where id = p_student_id;

  get diagnostics v_changed = row_count;

  select * into v_med_before
  from public.student_medical
  where student_id = p_student_id;

  v_med_exists := found;

  if v_med_exists then
    update public.student_medical set
      medical_notes = nullif(btrim(coalesce(p_medical_notes, '')), ''),
      vaccinated_smallpox = p_vaccinated_smallpox,
      vaccination_date = p_vaccination_date
    where student_id = p_student_id;
  else
    if coalesce(nullif(btrim(coalesce(p_medical_notes, '')), ''), '') <> ''
       or p_vaccinated_smallpox is not null
       or p_vaccination_date is not null then
      insert into public.student_medical (
        student_id,
        school_id,
        medical_notes,
        vaccinated_smallpox,
        vaccination_date
      ) values (
        p_student_id,
        v_school_id,
        nullif(btrim(coalesce(p_medical_notes, '')), ''),
        p_vaccinated_smallpox,
        p_vaccination_date
      );
      -- INSERT does not fire UPDATE audit trigger; log medical creates explicitly.
      if p_medical_notes is not null and btrim(p_medical_notes) <> '' then
        perform public.insert_profile_change_audit(
          v_school_id, p_student_id, null, 'student', 'medical_notes',
          null, p_medical_notes
        );
      end if;
      if p_vaccinated_smallpox is not null then
        perform public.insert_profile_change_audit(
          v_school_id, p_student_id, null, 'student', 'vaccinated_smallpox',
          null, public.profile_change_bool_text(p_vaccinated_smallpox)
        );
      end if;
      if p_vaccination_date is not null then
        perform public.insert_profile_change_audit(
          v_school_id, p_student_id, null, 'student', 'vaccination_date',
          null, p_vaccination_date::text
        );
      end if;
    end if;
  end if;

  perform public.clear_profile_change_context();

  return jsonb_build_object(
    'student_id', p_student_id,
    'ok', true
  );
exception
  when others then
    perform public.clear_profile_change_context();
    raise;
end;
$$;

comment on function public.update_student_profile is
  'Atomically updates pupil + medical fields and writes profile change audits. Requires can_manage_students().';

revoke all on function public.update_student_profile(
  uuid, text, text, text, text, date, public.gender, date,
  text, text, text, date, boolean, text, boolean, date, text, text
) from public, anon;
grant execute on function public.update_student_profile(
  uuid, text, text, text, text, date, public.gender, date,
  text, text, text, date, boolean, text, boolean, date, text, text
) to authenticated;

create or replace function public.update_guardian_profile(
  p_student_id uuid,
  p_guardian_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_alt_phone text,
  p_whatsapp text,
  p_email text,
  p_national_id text,
  p_occupation text,
  p_address text,
  p_postal_address text,
  p_relationship public.guardian_relationship,
  p_is_primary_contact boolean,
  p_is_emergency_contact boolean,
  p_change_reason text,
  p_change_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.student_guardians%rowtype;
  v_other_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  if not public.can_manage_students() then
    raise exception 'Not authorized to edit guardian profiles.';
  end if;

  select * into v_link
  from public.student_guardians
  where student_id = p_student_id
    and guardian_id = p_guardian_id
    and school_id = public.current_user_school_id()
  for update;

  if not found then
    raise exception 'Guardian is not linked to this pupil.';
  end if;

  select count(*)::integer into v_other_count
  from public.student_guardians
  where guardian_id = p_guardian_id
    and student_id <> p_student_id;

  perform public.set_profile_change_context(
    p_change_reason,
    p_change_note,
    p_student_id
  );

  update public.guardians set
    first_name = btrim(p_first_name),
    last_name = btrim(p_last_name),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    alt_phone = nullif(btrim(coalesce(p_alt_phone, '')), ''),
    whatsapp = nullif(btrim(coalesce(p_whatsapp, '')), ''),
    email = nullif(btrim(coalesce(p_email, '')), ''),
    national_id = nullif(btrim(coalesce(p_national_id, '')), ''),
    occupation = nullif(btrim(coalesce(p_occupation, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    postal_address = nullif(btrim(coalesce(p_postal_address, '')), '')
  where id = p_guardian_id
    and school_id = public.current_user_school_id();

  if p_is_primary_contact then
    update public.student_guardians
    set is_primary_contact = false
    where student_id = p_student_id
      and guardian_id <> p_guardian_id
      and is_primary_contact = true;
  end if;

  update public.student_guardians set
    relationship = p_relationship,
    is_primary_contact = coalesce(p_is_primary_contact, false),
    is_emergency_contact = coalesce(p_is_emergency_contact, false)
  where student_id = p_student_id
    and guardian_id = p_guardian_id;

  perform public.clear_profile_change_context();

  return jsonb_build_object(
    'student_id', p_student_id,
    'guardian_id', p_guardian_id,
    'shared_with_other_students', v_other_count,
    'ok', true
  );
exception
  when others then
    perform public.clear_profile_change_context();
    raise;
end;
$$;

comment on function public.update_guardian_profile is
  'Atomically updates a shared guardian + this pupil link and writes audits. Requires can_manage_students().';

revoke all on function public.update_guardian_profile(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  public.guardian_relationship, boolean, boolean, text, text
) from public, anon;
grant execute on function public.update_guardian_profile(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  public.guardian_relationship, boolean, boolean, text, text
) to authenticated;

-- Count other pupils sharing a guardian (for UI warning)
create or replace function public.count_guardian_linked_students(p_guardian_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count integer;
begin
  if not public.can_manage_students() then
    raise exception 'Not authorized.';
  end if;

  select count(*)::integer into v_count
  from public.student_guardians
  where guardian_id = p_guardian_id
    and school_id = public.current_user_school_id();

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.count_guardian_linked_students(uuid) from public, anon;
grant execute on function public.count_guardian_linked_students(uuid) to authenticated;
