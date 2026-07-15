-- ===========================================================================
-- Sprint 2 (Security): medical / vaccination privacy
--
-- File: 20260716100200_student_medical_privacy.sql
--
-- Moves medical fields off public.students into public.student_medical with
-- RLS limited to can_manage_students() (admin / headteacher / secretary).
-- Bursars and teachers cannot SELECT medical rows.
-- ===========================================================================

create table if not exists public.student_medical (
  student_id            uuid primary key
    references public.students (id) on delete cascade,
  school_id             uuid not null
    references public.schools (id) on delete restrict,
  medical_notes         text,
  vaccinated_smallpox   boolean,
  vaccination_date      date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists student_medical_school_idx
  on public.student_medical (school_id);

create trigger student_medical_set_updated_at
before update on public.student_medical
for each row execute function public.set_updated_at();

comment on table public.student_medical is
  'Restricted health data. SELECT/WRITE only for can_manage_students().';

-- Move existing data (idempotent for rows already copied)
insert into public.student_medical (
  student_id, school_id, medical_notes, vaccinated_smallpox, vaccination_date
)
select
  s.id,
  s.school_id,
  s.medical_notes,
  s.vaccinated_smallpox,
  s.vaccination_date
from public.students as s
where s.medical_notes is not null
   or s.vaccinated_smallpox is not null
   or s.vaccination_date is not null
on conflict (student_id) do nothing;

alter table public.students
  drop column if exists medical_notes,
  drop column if exists vaccinated_smallpox,
  drop column if exists vaccination_date;

alter table public.student_medical enable row level security;

drop policy if exists "student_medical_select" on public.student_medical;
drop policy if exists "student_medical_insert" on public.student_medical;
drop policy if exists "student_medical_update" on public.student_medical;
drop policy if exists "student_medical_delete" on public.student_medical;

create policy "student_medical_select" on public.student_medical
  for select to authenticated
  using (
    public.can_manage_students()
    and school_id = public.current_user_school_id()
  );

create policy "student_medical_insert" on public.student_medical
  for insert to authenticated
  with check (
    public.can_manage_students()
    and school_id = public.current_user_school_id()
  );

create policy "student_medical_update" on public.student_medical
  for update to authenticated
  using (
    public.can_manage_students()
    and school_id = public.current_user_school_id()
  )
  with check (
    public.can_manage_students()
    and school_id = public.current_user_school_id()
  );

-- No DELETE policy — soft-update only; student archive keeps medical history.

revoke delete on table public.student_medical from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upsert helper used by enrolment RPCs
-- ---------------------------------------------------------------------------
create or replace function public.upsert_student_medical(
  p_student_id            uuid,
  p_school_id             uuid,
  p_vaccinated_smallpox   boolean,
  p_vaccination_date      date,
  p_medical_notes         text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_vaccinated_smallpox is null
     and p_vaccination_date is null
     and nullif(p_medical_notes, '') is null
  then
    return;
  end if;

  insert into public.student_medical (
    student_id, school_id, vaccinated_smallpox, vaccination_date, medical_notes
  ) values (
    p_student_id,
    p_school_id,
    p_vaccinated_smallpox,
    p_vaccination_date,
    nullif(p_medical_notes, '')
  )
  on conflict (student_id) do update set
    vaccinated_smallpox = excluded.vaccinated_smallpox,
    vaccination_date = excluded.vaccination_date,
    medical_notes = excluded.medical_notes;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recreate enrolment RPCs without medical columns on students
-- ---------------------------------------------------------------------------
create or replace function public.create_enrolled_student(
  p_admission_number         text,
  p_first_name               text,
  p_middle_name              text,
  p_last_name                text,
  p_date_of_birth            date,
  p_gender                   public.gender,
  p_enrollment_date          date,
  p_class_id                 uuid,
  p_guardians                jsonb,
  p_place_of_birth           text default null,
  p_religious_denomination   text default null,
  p_previous_school          text default null,
  p_proposed_admission_date  date default null,
  p_vaccinated_smallpox      boolean default null,
  p_vaccination_date         date default null,
  p_medical_notes            text default null,
  p_is_zambian_citizen       boolean default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_student_id       uuid;
  v_academic_year_id uuid;
  v_guardian         jsonb;
  v_guardian_id      uuid;
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to enrol students.';
  end if;

  select c.academic_year_id into v_academic_year_id
  from public.classes as c
  where c.id = p_class_id and c.school_id = v_school_id;

  if v_academic_year_id is null then
    raise exception 'The selected class was not found.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status, enrollment_date,
    place_of_birth, religious_denomination, previous_school,
    proposed_admission_date, is_zambian_citizen
  ) values (
    v_school_id, p_admission_number, p_first_name, nullif(p_middle_name, ''),
    p_last_name, p_date_of_birth, p_gender, 'enrolled',
    coalesce(p_enrollment_date, current_date),
    nullif(p_place_of_birth, ''),
    nullif(p_religious_denomination, ''),
    nullif(p_previous_school, ''),
    p_proposed_admission_date,
    p_is_zambian_citizen
  )
  returning id into v_student_id;

  perform public.upsert_student_medical(
    v_student_id,
    v_school_id,
    p_vaccinated_smallpox,
    p_vaccination_date,
    p_medical_notes
  );

  for v_guardian in
    select * from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb))
  loop
    insert into public.guardians (
      school_id, first_name, last_name, phone, alt_phone, whatsapp, email,
      national_id, occupation, address, postal_address
    ) values (
      v_school_id,
      v_guardian->>'first_name',
      v_guardian->>'last_name',
      nullif(v_guardian->>'phone', ''),
      nullif(v_guardian->>'alt_phone', ''),
      nullif(v_guardian->>'whatsapp', ''),
      nullif(v_guardian->>'email', ''),
      nullif(v_guardian->>'national_id', ''),
      nullif(v_guardian->>'occupation', ''),
      nullif(v_guardian->>'address', ''),
      nullif(v_guardian->>'postal_address', '')
    )
    returning id into v_guardian_id;

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
    );
  end loop;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status, enrolled_on
  ) values (
    v_school_id, v_student_id, p_class_id, v_academic_year_id, 'active',
    coalesce(p_enrollment_date, current_date)
  );

  return v_student_id;
end;
$$;

create or replace function public.create_application(
  p_admission_number         text,
  p_first_name               text,
  p_middle_name              text,
  p_last_name                text,
  p_date_of_birth            date,
  p_gender                   public.gender,
  p_applied_class_id         uuid,
  p_consent_agreed           boolean,
  p_consent_signed_by        text,
  p_consent_signed_at        date,
  p_guardians                jsonb,
  p_place_of_birth           text default null,
  p_religious_denomination   text default null,
  p_previous_school          text default null,
  p_proposed_admission_date  date default null,
  p_vaccinated_smallpox      boolean default null,
  p_vaccination_date         date default null,
  p_medical_notes            text default null,
  p_is_zambian_citizen       boolean default null,
  p_emergency_contact_phone  text default null,
  p_media_release_agreed     boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id      uuid := public.current_user_school_id();
  v_student_id     uuid;
  v_application_id uuid;
  v_guardian       jsonb;
  v_guardian_id    uuid;
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to create applications.';
  end if;

  if p_applied_class_id is not null and not exists (
    select 1 from public.classes as c
    where c.id = p_applied_class_id and c.school_id = v_school_id
  ) then
    raise exception 'The selected class was not found.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status,
    place_of_birth, religious_denomination, previous_school,
    proposed_admission_date, is_zambian_citizen
  ) values (
    v_school_id, p_admission_number, p_first_name, nullif(p_middle_name, ''),
    p_last_name, p_date_of_birth, p_gender, 'applicant',
    nullif(p_place_of_birth, ''),
    nullif(p_religious_denomination, ''),
    nullif(p_previous_school, ''),
    p_proposed_admission_date,
    p_is_zambian_citizen
  )
  returning id into v_student_id;

  perform public.upsert_student_medical(
    v_student_id,
    v_school_id,
    p_vaccinated_smallpox,
    p_vaccination_date,
    p_medical_notes
  );

  for v_guardian in
    select * from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb))
  loop
    insert into public.guardians (
      school_id, first_name, last_name, phone, alt_phone, whatsapp, email,
      national_id, occupation, address, postal_address
    ) values (
      v_school_id,
      v_guardian->>'first_name',
      v_guardian->>'last_name',
      nullif(v_guardian->>'phone', ''),
      nullif(v_guardian->>'alt_phone', ''),
      nullif(v_guardian->>'whatsapp', ''),
      nullif(v_guardian->>'email', ''),
      nullif(v_guardian->>'national_id', ''),
      nullif(v_guardian->>'occupation', ''),
      nullif(v_guardian->>'address', ''),
      nullif(v_guardian->>'postal_address', '')
    )
    returning id into v_guardian_id;

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
    );
  end loop;

  insert into public.applications (
    school_id, student_id, status, submitted_at, submitted_by,
    applied_class_id, consent_agreed, consent_signed_by, consent_signed_at,
    emergency_contact_phone, media_release_agreed
  ) values (
    v_school_id, v_student_id, 'submitted', now(), auth.uid(),
    p_applied_class_id, coalesce(p_consent_agreed, false),
    nullif(p_consent_signed_by, ''), p_consent_signed_at,
    nullif(p_emergency_contact_phone, ''),
    coalesce(p_media_release_agreed, false)
  )
  returning id into v_application_id;

  return v_application_id;
end;
$$;
