-- ===========================================================================
-- Sprint 3 lows: attendance school-day uniqueness + cover overlap (L5, L6)
--
-- File: 20260716140000_attendance_uniqueness_and_cover_overlap.sql
--
-- L5 — One attendance mark per student per calendar day (school-wide)
-- L6 — No overlapping active cover windows for the same class + teacher
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- L5: Dedupe then enforce (student_id, attendance_date)
-- Prefer the most recently updated row; move audits to the survivor.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_keep uuid;
begin
  for r in
    select student_id, attendance_date
    from public.attendance_records
    group by student_id, attendance_date
    having count(*) > 1
  loop
    select id
    into v_keep
    from public.attendance_records
    where student_id = r.student_id
      and attendance_date = r.attendance_date
    order by updated_at desc nulls last, created_at desc nulls last, id
    limit 1;

    update public.attendance_record_audits as a
    set attendance_record_id = v_keep
    where a.attendance_record_id in (
      select id
      from public.attendance_records
      where student_id = r.student_id
        and attendance_date = r.attendance_date
        and id <> v_keep
    );

    delete from public.attendance_records
    where student_id = r.student_id
      and attendance_date = r.attendance_date
      and id <> v_keep;
  end loop;
end;
$$;

alter table public.attendance_records
  drop constraint if exists attendance_records_class_id_student_id_attendance_date_key;

create unique index if not exists attendance_records_student_date_uidx
  on public.attendance_records (student_id, attendance_date);

comment on index public.attendance_records_student_date_uidx is
  'At most one attendance mark per student per calendar day across all classes.';

-- Update save_class_attendance to upsert on the school-day key.
create or replace function public.save_class_attendance(
  p_class_id         uuid,
  p_attendance_date  date,
  p_marks            jsonb
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_year_id   uuid;
  v_mark      jsonb;
  v_student   uuid;
  v_status    public.attendance_status;
  v_notes     text;
  v_count     int := 0;
begin
  if not public.can_take_attendance(p_class_id) then
    raise exception 'You are not authorized to take attendance for this class.';
  end if;

  if p_attendance_date is null then
    raise exception 'Attendance date is required.';
  end if;

  if jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    raise exception 'Provide at least one attendance mark.';
  end if;

  select academic_year_id into v_year_id
  from public.classes
  where id = p_class_id and school_id = v_school_id and is_active;

  if v_year_id is null then
    raise exception 'Class was not found.';
  end if;

  for v_mark in select * from jsonb_array_elements(p_marks)
  loop
    v_student := (v_mark->>'student_id')::uuid;
    v_status  := (v_mark->>'status')::public.attendance_status;
    v_notes   := coalesce(v_mark->>'notes', '');

    if v_student is null or v_status is null then
      raise exception 'Each mark needs student_id and status.';
    end if;

    if not exists (
      select 1
      from public.student_class_enrollments e
      where e.student_id = v_student
        and e.class_id = p_class_id
        and e.academic_year_id = v_year_id
        and e.status = 'active'
    ) then
      raise exception 'Student is not actively enrolled in this class.';
    end if;

    insert into public.attendance_records (
      school_id, class_id, student_id, attendance_date,
      status, notes, recorded_by
    ) values (
      v_school_id, p_class_id, v_student, p_attendance_date,
      v_status, v_notes, auth.uid()
    )
    on conflict (student_id, attendance_date)
    do update set
      class_id = excluded.class_id,
      status = excluded.status,
      notes = excluded.notes,
      recorded_by = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- L6: No overlapping active covers for same class + teacher
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

-- Close open-ended ranges with infinity for exclusion.
alter table public.class_attendance_covers
  drop constraint if exists class_attendance_covers_no_overlap;

alter table public.class_attendance_covers
  add constraint class_attendance_covers_no_overlap
  exclude using gist (
    class_id with =,
    staff_id with =,
    daterange(
      valid_from,
      coalesce(valid_until, 'infinity'::date),
      '[]'
    ) with &&
  )
  where (is_active);

comment on constraint class_attendance_covers_no_overlap on public.class_attendance_covers is
  'Active cover assignments for the same class and teacher must not overlap in date range.';

create or replace function public.assign_attendance_cover(
  p_class_id    uuid,
  p_staff_id    uuid,
  p_valid_from  date default ((now() at time zone 'Africa/Lusaka')::date),
  p_valid_until date default null,
  p_reason      text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_id        uuid;
  v_from      date := coalesce(
    p_valid_from,
    (now() at time zone 'Africa/Lusaka')::date
  );
begin
  if not public.can_manage_attendance_covers() then
    raise exception 'You are not authorized to assign cover teachers.';
  end if;

  if not exists (
    select 1 from public.classes
    where id = p_class_id and school_id = v_school_id and is_active
  ) then
    raise exception 'Class was not found.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_staff_id
      and school_id = v_school_id
      and is_active
      and role = 'teacher'
  ) then
    raise exception 'Cover must be an active teacher at this school.';
  end if;

  if p_valid_until is not null and p_valid_until < v_from then
    raise exception 'Cover end date cannot be before the start date.';
  end if;

  if exists (
    select 1
    from public.class_attendance_covers as cov
    where cov.class_id = p_class_id
      and cov.staff_id = p_staff_id
      and cov.is_active
      and daterange(
            cov.valid_from,
            coalesce(cov.valid_until, 'infinity'::date),
            '[]'
          ) &&
          daterange(
            v_from,
            coalesce(p_valid_until, 'infinity'::date),
            '[]'
          )
  ) then
    raise exception
      'This teacher already has an overlapping active cover for that class. Revoke or adjust dates first.';
  end if;

  begin
    insert into public.class_attendance_covers (
      school_id, class_id, staff_id,
      valid_from, valid_until, reason, granted_by
    ) values (
      v_school_id, p_class_id, p_staff_id,
      v_from, p_valid_until, coalesce(p_reason, ''), auth.uid()
    )
    returning id into v_id;
  exception
    when exclusion_violation then
      raise exception
        'This teacher already has an overlapping active cover for that class. Revoke or adjust dates first.';
  end;

  return v_id;
end;
$$;
