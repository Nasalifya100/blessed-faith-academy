-- ===========================================================================
-- Phase 3e: Align enrolment with the official Enrollment Form 2026
--
-- Adds the fields from Blessed Faith Academy's paper enrolment form that were
-- not captured in Phase 3a–3d, then updates create_enrolled_student() and
-- create_application() so new records can store them.
--
-- New columns are nullable / defaulted so existing students and applications
-- remain valid.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- students — Child's Details (form items 5–10, 18)
-- ---------------------------------------------------------------------------
alter table public.students
  add column if not exists place_of_birth         text,
  add column if not exists religious_denomination text,
  add column if not exists previous_school        text,
  add column if not exists proposed_admission_date date,
  add column if not exists vaccinated_smallpox    boolean,
  add column if not exists vaccination_date       date,
  add column if not exists medical_notes          text,
  add column if not exists is_zambian_citizen     boolean;

-- ---------------------------------------------------------------------------
-- guardians — Parent/Guardian Details (WhatsApp, postal vs residential)
-- Existing "address" remains residential address for backward compatibility.
-- ---------------------------------------------------------------------------
alter table public.guardians
  add column if not exists whatsapp        text,
  add column if not exists postal_address  text;

-- ---------------------------------------------------------------------------
-- applications — declaration extras (emergency contact + media release)
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists emergency_contact_phone text,
  add column if not exists media_release_agreed    boolean not null default false;

-- ---------------------------------------------------------------------------
-- create_enrolled_student — accepts the new student/guardian fields
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

  select academic_year_id into v_academic_year_id
  from public.classes
  where id = p_class_id and school_id = v_school_id;

  if v_academic_year_id is null then
    raise exception 'The selected class was not found.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status, enrollment_date,
    place_of_birth, religious_denomination, previous_school,
    proposed_admission_date, vaccinated_smallpox, vaccination_date,
    medical_notes, is_zambian_citizen
  ) values (
    v_school_id, p_admission_number, p_first_name, nullif(p_middle_name, ''),
    p_last_name, p_date_of_birth, p_gender, 'enrolled',
    coalesce(p_enrollment_date, current_date),
    nullif(p_place_of_birth, ''),
    nullif(p_religious_denomination, ''),
    nullif(p_previous_school, ''),
    p_proposed_admission_date,
    p_vaccinated_smallpox,
    p_vaccination_date,
    nullif(p_medical_notes, ''),
    p_is_zambian_citizen
  )
  returning id into v_student_id;

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

-- ---------------------------------------------------------------------------
-- create_application — accepts the new student/guardian/consent fields
-- ---------------------------------------------------------------------------
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
    select 1 from public.classes
    where id = p_applied_class_id and school_id = v_school_id
  ) then
    raise exception 'The selected class was not found.';
  end if;

  insert into public.students (
    school_id, admission_number, first_name, middle_name, last_name,
    date_of_birth, gender, status,
    place_of_birth, religious_denomination, previous_school,
    proposed_admission_date, vaccinated_smallpox, vaccination_date,
    medical_notes, is_zambian_citizen
  ) values (
    v_school_id, p_admission_number, p_first_name, nullif(p_middle_name, ''),
    p_last_name, p_date_of_birth, p_gender, 'applicant',
    nullif(p_place_of_birth, ''),
    nullif(p_religious_denomination, ''),
    nullif(p_previous_school, ''),
    p_proposed_admission_date,
    p_vaccinated_smallpox,
    p_vaccination_date,
    nullif(p_medical_notes, ''),
    p_is_zambian_citizen
  )
  returning id into v_student_id;

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
