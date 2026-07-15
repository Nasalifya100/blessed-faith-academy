-- ===========================================================================
-- Sprint 3: Reuse guardians by national ID / phone (M14)
--
-- File: 20260716130100_reuse_guardians.sql
--
-- When enrolling / applying, match an existing guardian in the same school by
-- national_id (preferred) or phone, then link. Otherwise create a new row.
-- ===========================================================================

create or replace function public.find_or_create_guardian(
  p_school_id uuid,
  p_guardian  jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id          uuid;
  v_national_id text := nullif(trim(coalesce(p_guardian->>'national_id', '')), '');
  v_phone       text := nullif(trim(coalesce(p_guardian->>'phone', '')), '');
  v_first_name  text := trim(coalesce(p_guardian->>'first_name', ''));
  v_last_name   text := trim(coalesce(p_guardian->>'last_name', ''));
begin
  if v_first_name = '' or v_last_name = '' then
    raise exception 'Guardian first and last name are required.';
  end if;

  if v_national_id is not null then
    select g.id
    into v_id
    from public.guardians as g
    where g.school_id = p_school_id
      and lower(g.national_id) = lower(v_national_id)
    order by g.created_at asc
    limit 1
    for update of g;
  end if;

  if v_id is null and v_phone is not null then
    select g.id
    into v_id
    from public.guardians as g
    where g.school_id = p_school_id
      and g.phone is not null
      and regexp_replace(g.phone, '\s+', '', 'g') =
          regexp_replace(v_phone, '\s+', '', 'g')
    order by g.created_at asc
    limit 1
    for update of g;
  end if;

  if v_id is not null then
    update public.guardians as g
    set
      first_name = v_first_name,
      last_name = v_last_name,
      phone = coalesce(v_phone, g.phone),
      alt_phone = coalesce(nullif(trim(coalesce(p_guardian->>'alt_phone', '')), ''), g.alt_phone),
      whatsapp = coalesce(nullif(trim(coalesce(p_guardian->>'whatsapp', '')), ''), g.whatsapp),
      email = coalesce(nullif(trim(coalesce(p_guardian->>'email', '')), ''), g.email),
      national_id = coalesce(v_national_id, g.national_id),
      occupation = coalesce(nullif(trim(coalesce(p_guardian->>'occupation', '')), ''), g.occupation),
      address = coalesce(nullif(trim(coalesce(p_guardian->>'address', '')), ''), g.address),
      postal_address = coalesce(
        nullif(trim(coalesce(p_guardian->>'postal_address', '')), ''),
        g.postal_address
      )
    where g.id = v_id;

    return v_id;
  end if;

  insert into public.guardians (
    school_id, first_name, last_name, phone, alt_phone, whatsapp, email,
    national_id, occupation, address, postal_address
  ) values (
    p_school_id,
    v_first_name,
    v_last_name,
    v_phone,
    nullif(trim(coalesce(p_guardian->>'alt_phone', '')), ''),
    nullif(trim(coalesce(p_guardian->>'whatsapp', '')), ''),
    nullif(trim(coalesce(p_guardian->>'email', '')), ''),
    v_national_id,
    nullif(trim(coalesce(p_guardian->>'occupation', '')), ''),
    nullif(trim(coalesce(p_guardian->>'address', '')), ''),
    nullif(trim(coalesce(p_guardian->>'postal_address', '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.find_or_create_guardian(uuid, jsonb) is
  'Match guardian by school + national_id or phone; otherwise insert. Used by enrolment/application RPCs.';

revoke all on function public.find_or_create_guardian(uuid, jsonb) from public;
revoke all on function public.find_or_create_guardian(uuid, jsonb) from anon;
grant execute on function public.find_or_create_guardian(uuid, jsonb) to authenticated;

-- Unique national ID per school when present (case-insensitive).
do $$
begin
  if exists (
    select 1
    from public.guardians
    where national_id is not null
      and trim(national_id) <> ''
    group by school_id, lower(national_id)
    having count(*) > 1
  ) then
    raise exception
      'Cannot create unique guardian national_id index: duplicate NRC values exist in the same school. Resolve them first.';
  end if;
end;
$$;

create unique index if not exists guardians_school_national_id_lower_uidx
  on public.guardians (school_id, lower(national_id))
  where national_id is not null and trim(national_id) <> '';

-- ---------------------------------------------------------------------------
-- Patch create_enrolled_student guardian loop
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
    coalesce(p_enrollment_date, (now() at time zone 'Africa/Lusaka')::date),
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
    v_guardian_id := public.find_or_create_guardian(v_school_id, v_guardian);

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
    v_school_id, v_student_id, p_class_id, v_academic_year_id, 'active',
    coalesce(p_enrollment_date, (now() at time zone 'Africa/Lusaka')::date)
  );

  return v_student_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch create_application guardian loop
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
    v_guardian_id := public.find_or_create_guardian(v_school_id, v_guardian);

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
