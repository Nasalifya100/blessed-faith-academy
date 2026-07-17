-- ===========================================================================
-- Add Existing Student — legacy manual migration
--
-- File: 20260717120000_existing_student_migration.sql
--
-- Adds:
--   * students.record_origin / migration metadata
--   * charges.charge_source / legacy amount metadata
--   * NORMAL-only unique charge indexes (legacy opening lines separate)
--   * legacy_migration_audits (append-only)
--   * create_existing_student_migration(jsonb) atomic RPC
--
-- Does NOT create applications or payment rows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Students — migration metadata
-- ---------------------------------------------------------------------------
alter table public.students
  add column if not exists record_origin text not null default 'NORMAL',
  add column if not exists migrated_at timestamptz,
  add column if not exists migrated_by uuid references public.profiles(id) on delete set null,
  add column if not exists legacy_reference text,
  add column if not exists migration_notes text;

alter table public.students
  drop constraint if exists students_record_origin_check;

alter table public.students
  add constraint students_record_origin_check
  check (record_origin in ('NORMAL', 'LEGACY_MANUAL'));

create index if not exists students_school_legacy_origin_idx
  on public.students (school_id, record_origin)
  where record_origin = 'LEGACY_MANUAL';

comment on column public.students.record_origin is
  'NORMAL = created via enrol/application; LEGACY_MANUAL = Add Existing Student migration.';
comment on column public.students.enrollment_date is
  'Historical admission / enrolment date. For LEGACY_MANUAL this is the real join date, not the digitisation date.';

-- ---------------------------------------------------------------------------
-- 2. Charges — legacy opening balance metadata
-- ---------------------------------------------------------------------------
alter table public.charges
  add column if not exists charge_source text not null default 'NORMAL',
  add column if not exists legacy_original_amount numeric(12, 2),
  add column if not exists legacy_previously_paid_amount numeric(12, 2),
  add column if not exists legacy_notes text,
  add column if not exists migrated_at timestamptz,
  add column if not exists migrated_by uuid references public.profiles(id) on delete set null;

alter table public.charges
  drop constraint if exists charges_charge_source_check;

alter table public.charges
  add constraint charges_charge_source_check
  check (charge_source in ('NORMAL', 'LEGACY_OPENING_BALANCE'));

alter table public.charges
  drop constraint if exists charges_legacy_amounts_check;

alter table public.charges
  add constraint charges_legacy_amounts_check
  check (
    charge_source <> 'LEGACY_OPENING_BALANCE'
    or (
      legacy_original_amount is not null
      and legacy_previously_paid_amount is not null
      and legacy_original_amount >= 0
      and legacy_previously_paid_amount >= 0
      and legacy_previously_paid_amount <= legacy_original_amount
      and amount = round(legacy_original_amount - legacy_previously_paid_amount, 2)
    )
  );

comment on column public.charges.charge_source is
  'NORMAL = catalogue-generated; LEGACY_OPENING_BALANCE = pre-system outstanding (no payment row).';

-- ---------------------------------------------------------------------------
-- 3. Unique indexes: NORMAL only + legacy duplicate guard
-- ---------------------------------------------------------------------------
drop index if exists public.charges_student_item_term_active_uidx;
drop index if exists public.charges_student_item_year_active_uidx;

create unique index charges_student_item_term_active_uidx
  on public.charges (student_id, fee_item_id, term_id)
  where status <> 'cancelled'::public.charge_status
    and term_id is not null
    and charge_source = 'NORMAL';

create unique index charges_student_item_year_active_uidx
  on public.charges (student_id, fee_item_id, academic_year_id)
  where status <> 'cancelled'::public.charge_status
    and term_id is null
    and charge_source = 'NORMAL';

-- One legacy opening line per fee item per year/term (term null = year-scoped).
create unique index if not exists charges_legacy_opening_term_uidx
  on public.charges (student_id, fee_item_id, term_id)
  where status <> 'cancelled'::public.charge_status
    and term_id is not null
    and charge_source = 'LEGACY_OPENING_BALANCE';

create unique index if not exists charges_legacy_opening_year_uidx
  on public.charges (student_id, fee_item_id, academic_year_id)
  where status <> 'cancelled'::public.charge_status
    and term_id is null
    and charge_source = 'LEGACY_OPENING_BALANCE';

-- Meal exclusivity applies to NORMAL charges only (legacy opening may reference meal).
create or replace function public.charges_enforce_one_meal_per_term()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category public.fee_category;
begin
  if coalesce(new.charge_source, 'NORMAL') = 'LEGACY_OPENING_BALANCE' then
    return new;
  end if;

  select fi.category
  into v_category
  from public.fee_items as fi
  where fi.id = new.fee_item_id;

  if v_category is distinct from 'meal'::public.fee_category then
    return new;
  end if;

  if new.status = 'cancelled'::public.charge_status then
    return new;
  end if;

  if new.term_id is null then
    raise exception 'Meal charges require a term.';
  end if;

  if exists (
    select 1
    from public.charges as c
    join public.fee_items as fi on fi.id = c.fee_item_id
    where c.student_id = new.student_id
      and c.term_id = new.term_id
      and c.status <> 'cancelled'::public.charge_status
      and coalesce(c.charge_source, 'NORMAL') = 'NORMAL'
      and fi.category = 'meal'::public.fee_category
      and c.id is distinct from new.id
  ) then
    raise exception
      'This student already has a meal plan for this term. Cancel that charge first to change it.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Audit table
-- ---------------------------------------------------------------------------
create table if not exists public.legacy_migration_audits (
  id                         uuid primary key default gen_random_uuid(),
  school_id                  uuid not null references public.schools(id) on delete restrict,
  student_id                 uuid not null references public.students(id) on delete restrict,
  actor_id                   uuid references public.profiles(id) on delete set null,
  admission_number           text not null,
  historical_admission_date  date not null,
  opening_balance_total      numeric(12, 2) not null default 0,
  payload                    jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now()
);

create index if not exists legacy_migration_audits_student_idx
  on public.legacy_migration_audits (student_id, created_at desc);

create index if not exists legacy_migration_audits_school_idx
  on public.legacy_migration_audits (school_id, created_at desc);

alter table public.legacy_migration_audits enable row level security;

drop policy if exists "legacy_migration_audits_select" on public.legacy_migration_audits;
create policy "legacy_migration_audits_select"
  on public.legacy_migration_audits
  for select
  to authenticated
  using (school_id = public.current_user_school_id());

-- No INSERT/UPDATE/DELETE for authenticated — RPC only (table owner / definer).
revoke insert, update, delete on table public.legacy_migration_audits from anon, authenticated;
grant select on table public.legacy_migration_audits to authenticated;

comment on table public.legacy_migration_audits is
  'Append-only audit of Add Existing Student migrations. Written only by create_existing_student_migration.';

-- ---------------------------------------------------------------------------
-- 5. Atomic RPC
-- ---------------------------------------------------------------------------
create or replace function public.create_existing_student_migration(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_actor_id         uuid := auth.uid();
  v_student_id       uuid;
  v_academic_year_id uuid;
  v_class_year_id    uuid;
  v_class_id         uuid;
  v_admission        text;
  v_admission_date   date;
  v_placement_date   date;
  v_status           public.student_status;
  v_guardian         jsonb;
  v_guardian_id      uuid;
  v_existing_id      uuid;
  v_line             jsonb;
  v_fee_item_id      uuid;
  v_fee_name         text;
  v_term_id          uuid;
  v_year_id          uuid;
  v_original         numeric(12, 2);
  v_paid             numeric(12, 2);
  v_outstanding      numeric(12, 2);
  v_charge_id        uuid;
  v_charge_ids       uuid[] := array[]::uuid[];
  v_opening_total    numeric(12, 2) := 0;
  v_seen_keys        text[] := array[]::text[];
  v_line_key         text;
  v_guardian_ids     uuid[] := array[]::uuid[];
begin
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  if not public.can_manage_students() or not public.can_manage_fees() then
    raise exception
      'You are not authorized to add existing students. This requires both student and fee management permission.';
  end if;

  v_admission := upper(trim(coalesce(p_payload->>'admission_number', '')));
  if v_admission = '' then
    raise exception 'Admission number is required.';
  end if;

  if exists (
    select 1
    from public.students as s
    where s.school_id = v_school_id
      and lower(s.admission_number) = lower(v_admission)
  ) then
    raise exception 'That admission number is already in use. Please use a different one.';
  end if;

  begin
    v_admission_date := (p_payload->>'admission_date')::date;
  exception when others then
    raise exception 'Enter a valid admission date.';
  end;

  if v_admission_date is null then
    raise exception 'Admission date is required.';
  end if;

  if v_admission_date > (now() at time zone 'Africa/Lusaka')::date then
    raise exception 'Admission date cannot be in the future.';
  end if;

  begin
    v_placement_date := nullif(p_payload->>'placement_effective_date', '')::date;
  exception when others then
    raise exception 'Enter a valid placement date.';
  end;
  v_placement_date := coalesce(v_placement_date, v_admission_date);

  v_status := coalesce(
    nullif(p_payload->>'status', '')::public.student_status,
    'enrolled'::public.student_status
  );
  if v_status = 'applicant'::public.student_status then
    raise exception 'Existing students cannot be created with applicant status.';
  end if;
  if v_status = 'rejected'::public.student_status then
    raise exception 'Choose enrolled, withdrawn, or graduated for an existing student.';
  end if;

  v_class_id := nullif(p_payload->>'class_id', '')::uuid;
  if v_class_id is null then
    raise exception 'Please choose a class.';
  end if;

  select c.academic_year_id
  into v_class_year_id
  from public.classes as c
  where c.id = v_class_id
    and c.school_id = v_school_id
    and c.is_active;

  if v_class_year_id is null then
    raise exception 'The selected class was not found or is inactive.';
  end if;

  select ay.id
  into v_academic_year_id
  from public.academic_years as ay
  where ay.school_id = v_school_id
    and ay.is_current
  limit 1;

  if v_academic_year_id is null then
    raise exception 'No current academic year is set. Configure the school year first.';
  end if;

  if v_class_year_id <> v_academic_year_id then
    raise exception 'The selected class must belong to the current academic year.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status, enrollment_date,
    place_of_birth, religious_denomination, previous_school,
    proposed_admission_date, is_zambian_citizen,
    record_origin, migrated_at, migrated_by, legacy_reference, migration_notes
  ) values (
    v_school_id,
    v_admission,
    trim(coalesce(p_payload->>'first_name', '')),
    nullif(trim(coalesce(p_payload->>'middle_name', '')), ''),
    trim(coalesce(p_payload->>'last_name', '')),
    (p_payload->>'date_of_birth')::date,
    (p_payload->>'gender')::public.gender,
    v_status,
    v_admission_date,
    nullif(trim(coalesce(p_payload->>'place_of_birth', '')), ''),
    nullif(trim(coalesce(p_payload->>'religious_denomination', '')), ''),
    nullif(trim(coalesce(p_payload->>'previous_school', '')), ''),
    nullif(p_payload->>'proposed_admission_date', '')::date,
    case
      when p_payload ? 'is_zambian_citizen'
           and jsonb_typeof(p_payload->'is_zambian_citizen') = 'boolean'
        then (p_payload->>'is_zambian_citizen')::boolean
      else null
    end,
    'LEGACY_MANUAL',
    now(),
    v_actor_id,
    nullif(trim(coalesce(p_payload->>'legacy_reference', '')), ''),
    nullif(trim(coalesce(p_payload->>'migration_notes', '')), '')
  )
  returning id into v_student_id;

  perform public.upsert_student_medical(
    v_student_id,
    v_school_id,
    case
      when p_payload ? 'vaccinated_smallpox'
           and jsonb_typeof(p_payload->'vaccinated_smallpox') = 'boolean'
        then (p_payload->>'vaccinated_smallpox')::boolean
      else null
    end,
    nullif(p_payload->>'vaccination_date', '')::date,
    nullif(trim(coalesce(p_payload->>'medical_notes', '')), '')
  );

  if jsonb_array_length(coalesce(p_payload->'guardians', '[]'::jsonb)) < 1 then
    raise exception 'Add at least one parent or guardian.';
  end if;

  for v_guardian in
    select * from jsonb_array_elements(coalesce(p_payload->'guardians', '[]'::jsonb))
  loop
    v_existing_id := nullif(v_guardian->>'existing_guardian_id', '')::uuid;
    v_guardian_id := public.find_or_create_guardian(
      v_school_id, v_guardian, v_existing_id
    );
    v_guardian_ids := array_append(v_guardian_ids, v_guardian_id);

    insert into public.student_guardians (
      school_id, student_id, guardian_id, relationship,
      is_primary_contact, is_emergency_contact
    ) values (
      v_school_id,
      v_student_id,
      v_guardian_id,
      (v_guardian->>'relationship')::public.guardian_relationship,
      coalesce((v_guardian->>'is_primary_contact')::boolean, false),
      coalesce((v_guardian->>'is_emergency_contact')::boolean, false)
    )
    on conflict (student_id, guardian_id) do update set
      relationship = excluded.relationship,
      is_primary_contact = excluded.is_primary_contact,
      is_emergency_contact = excluded.is_emergency_contact;
  end loop;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status, enrolled_on
  ) values (
    v_school_id, v_student_id, v_class_id, v_academic_year_id, 'active',
    v_placement_date
  );

  for v_line in
    select * from jsonb_array_elements(coalesce(p_payload->'opening_charges', '[]'::jsonb))
  loop
    v_fee_item_id := nullif(v_line->>'fee_item_id', '')::uuid;
    if v_fee_item_id is null then
      raise exception 'Each opening charge must select a fee type.';
    end if;

    select fi.name
    into v_fee_name
    from public.fee_items as fi
    where fi.id = v_fee_item_id
      and fi.school_id = v_school_id
      and fi.is_active;

    if v_fee_name is null then
      raise exception 'A selected fee type was not found or is inactive.';
    end if;

    v_year_id := coalesce(
      nullif(v_line->>'academic_year_id', '')::uuid,
      v_academic_year_id
    );

    if not exists (
      select 1 from public.academic_years as ay
      where ay.id = v_year_id and ay.school_id = v_school_id
    ) then
      raise exception 'An opening charge references an invalid academic year.';
    end if;

    v_term_id := nullif(v_line->>'term_id', '')::uuid;
    if v_term_id is not null and not exists (
      select 1 from public.terms as t
      where t.id = v_term_id
        and t.school_id = v_school_id
        and t.academic_year_id = v_year_id
    ) then
      raise exception 'An opening charge references a term that does not match its academic year.';
    end if;

    begin
      v_original := round(coalesce((v_line->>'original_amount')::numeric, 0), 2);
      v_paid := round(coalesce((v_line->>'previously_paid_amount')::numeric, 0), 2);
    exception when others then
      raise exception 'Opening charge amounts must be valid numbers.';
    end;

    if v_original < 0 or v_paid < 0 then
      raise exception 'Opening charge amounts cannot be negative.';
    end if;

    if v_paid > v_original then
      raise exception 'Previously paid cannot exceed the original amount.';
    end if;

    v_outstanding := round(v_original - v_paid, 2);

    -- Zero outstanding: migration context only; do not create a charge row.
    if v_outstanding = 0 then
      continue;
    end if;

    v_line_key := v_fee_item_id::text || ':' || v_year_id::text || ':' || coalesce(v_term_id::text, 'year');
    if v_line_key = any (v_seen_keys) then
      raise exception 'Duplicate opening charge for the same fee type and period.';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_line_key);

    -- Conflict with an existing NORMAL active charge for same fee+period.
    if exists (
      select 1
      from public.charges as c
      where c.student_id = v_student_id
        and c.fee_item_id = v_fee_item_id
        and c.status <> 'cancelled'::public.charge_status
        and coalesce(c.charge_source, 'NORMAL') = 'NORMAL'
        and (
          (v_term_id is not null and c.term_id = v_term_id)
          or (v_term_id is null and c.term_id is null and c.academic_year_id = v_year_id)
        )
    ) then
      raise exception
        'A generated charge already exists for % in this period. Resolve it before adding a legacy opening balance.',
        v_fee_name;
    end if;

    insert into public.charges (
      school_id, student_id, fee_item_id, academic_year_id, term_id,
      amount, currency, description, status, created_by,
      charge_source, legacy_original_amount, legacy_previously_paid_amount,
      legacy_notes, migrated_at, migrated_by
    ) values (
      v_school_id,
      v_student_id,
      v_fee_item_id,
      v_year_id,
      v_term_id,
      v_outstanding,
      'ZMW',
      coalesce(
        nullif(trim(coalesce(v_line->>'description', '')), ''),
        'Opening balance — ' || v_fee_name
      ),
      'outstanding'::public.charge_status,
      v_actor_id,
      'LEGACY_OPENING_BALANCE',
      v_original,
      v_paid,
      nullif(trim(coalesce(v_line->>'notes', '')), ''),
      now(),
      v_actor_id
    )
    returning id into v_charge_id;

    v_charge_ids := array_append(v_charge_ids, v_charge_id);
    v_opening_total := v_opening_total + v_outstanding;
  end loop;

  insert into public.legacy_migration_audits (
    school_id, student_id, actor_id, admission_number,
    historical_admission_date, opening_balance_total, payload
  ) values (
    v_school_id,
    v_student_id,
    v_actor_id,
    v_admission,
    v_admission_date,
    v_opening_total,
    jsonb_build_object(
      'event', 'legacy_student_migration_completed',
      'class_id', v_class_id,
      'guardian_ids', to_jsonb(v_guardian_ids),
      'charge_ids', to_jsonb(v_charge_ids),
      'status', v_status::text,
      'legacy_reference', nullif(trim(coalesce(p_payload->>'legacy_reference', '')), ''),
      'has_migration_notes',
        nullif(trim(coalesce(p_payload->>'migration_notes', '')), '') is not null
    )
  );

  return jsonb_build_object(
    'student_id', v_student_id,
    'charge_ids', to_jsonb(v_charge_ids),
    'opening_total', v_opening_total,
    'admission_number', v_admission
  );
end;
$$;

comment on function public.create_existing_student_migration(jsonb) is
  'Atomically creates a LEGACY_MANUAL student, guardians, class placement, and LEGACY_OPENING_BALANCE charges. No applications or payments. Requires can_manage_students and can_manage_fees.';

revoke all on function public.create_existing_student_migration(jsonb) from public;
revoke all on function public.create_existing_student_migration(jsonb) from anon;
grant execute on function public.create_existing_student_migration(jsonb) to authenticated;
