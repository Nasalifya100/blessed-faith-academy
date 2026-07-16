-- ===========================================================================
-- Sprint 4: Safer guardian reuse (NRC auto-link; phone never silent-merge)
--
-- File: 20260716150300_guardian_safe_reuse.sql
--
-- Replaces find_or_create_guardian:
--   * Exact NRC match (case-insensitive) → reuse existing row (strong signal)
--   * Phone alone → never auto-link; insert new unless p_existing_guardian_id set
--   * Explicit p_existing_guardian_id → link after school check
--   * On reuse, only fill blank contact fields (no overwrite of existing values)
-- Also adds list_guardian_candidates for UI confirmation.
-- ===========================================================================

create or replace function public.list_guardian_candidates(
  p_national_id text default null,
  p_phone       text default null
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  phone text,
  national_id text,
  match_reason text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_nrc text := nullif(trim(coalesce(p_national_id, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if not public.can_manage_students() then
    raise exception 'You are not authorized to search guardians.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  if v_nrc is null and v_phone is null then
    return;
  end if;

  return query
  select
    g.id,
    g.first_name,
    g.last_name,
    g.phone,
    g.national_id,
    case
      when v_nrc is not null
           and g.national_id is not null
           and lower(g.national_id) = lower(v_nrc)
        then 'national_id'
      else 'phone'
    end as match_reason
  from public.guardians as g
  where g.school_id = v_school_id
    and (
      (
        v_nrc is not null
        and g.national_id is not null
        and lower(g.national_id) = lower(v_nrc)
      )
      or (
        v_phone is not null
        and g.phone is not null
        and regexp_replace(g.phone, '\s+', '', 'g') =
            regexp_replace(v_phone, '\s+', '', 'g')
      )
    )
  order by
    case
      when v_nrc is not null
           and g.national_id is not null
           and lower(g.national_id) = lower(v_nrc)
        then 0
      else 1
    end,
    g.created_at asc
  limit 20;
end;
$$;

comment on function public.list_guardian_candidates(text, text) is
  'Returns guardian candidates by NRC or phone for staff confirmation. Does not mutate.';

revoke all on function public.list_guardian_candidates(text, text) from public;
revoke all on function public.list_guardian_candidates(text, text) from anon;
grant execute on function public.list_guardian_candidates(text, text) to authenticated;

create or replace function public.find_or_create_guardian(
  p_school_id            uuid,
  p_guardian             jsonb,
  p_existing_guardian_id uuid default null
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

  -- Explicit staff confirmation (sibling reuse).
  if p_existing_guardian_id is not null then
    select g.id
    into v_id
    from public.guardians as g
    where g.id = p_existing_guardian_id
      and g.school_id = p_school_id
    for update of g;

    if v_id is null then
      raise exception 'Selected guardian was not found at this school.';
    end if;
  end if;

  -- Strong signal only: case-insensitive NRC match (no name matching).
  if v_id is null and v_national_id is not null then
    select g.id
    into v_id
    from public.guardians as g
    where g.school_id = p_school_id
      and g.national_id is not null
      and lower(g.national_id) = lower(v_national_id)
    order by g.created_at asc
    limit 1
    for update of g;
  end if;

  -- Phone alone never auto-links (too weak / shared numbers).

  if v_id is not null then
    -- Fill blanks only; never overwrite existing contact values.
    update public.guardians as g
    set
      phone = coalesce(g.phone, v_phone),
      alt_phone = coalesce(
        g.alt_phone,
        nullif(trim(coalesce(p_guardian->>'alt_phone', '')), '')
      ),
      whatsapp = coalesce(
        g.whatsapp,
        nullif(trim(coalesce(p_guardian->>'whatsapp', '')), '')
      ),
      email = coalesce(
        g.email,
        nullif(trim(coalesce(p_guardian->>'email', '')), '')
      ),
      national_id = coalesce(g.national_id, v_national_id),
      occupation = coalesce(
        g.occupation,
        nullif(trim(coalesce(p_guardian->>'occupation', '')), '')
      ),
      address = coalesce(
        g.address,
        nullif(trim(coalesce(p_guardian->>'address', '')), '')
      ),
      postal_address = coalesce(
        g.postal_address,
        nullif(trim(coalesce(p_guardian->>'postal_address', '')), '')
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

comment on function public.find_or_create_guardian(uuid, jsonb, uuid) is
  'Reuse guardian by explicit id or NRC; phone never silent-merges. Blank-fill only on reuse.';

-- Drop old 2-arg overload so callers cannot bypass the safe signature.
drop function if exists public.find_or_create_guardian(uuid, jsonb);

revoke all on function public.find_or_create_guardian(uuid, jsonb, uuid) from public;
revoke all on function public.find_or_create_guardian(uuid, jsonb, uuid) from anon;
grant execute on function public.find_or_create_guardian(uuid, jsonb, uuid) to authenticated;

-- Patch enrolment / application loops to pass null existing id
-- (explicit link comes from JSON key existing_guardian_id when present).
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
  v_existing_id      uuid;
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
    v_existing_id := nullif(v_guardian->>'existing_guardian_id', '')::uuid;
    v_guardian_id := public.find_or_create_guardian(
      v_school_id, v_guardian, v_existing_id
    );

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
  v_existing_id    uuid;
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
    v_existing_id := nullif(v_guardian->>'existing_guardian_id', '')::uuid;
    v_guardian_id := public.find_or_create_guardian(
      v_school_id, v_guardian, v_existing_id
    );

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
