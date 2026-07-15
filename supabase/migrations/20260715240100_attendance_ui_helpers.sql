-- ===========================================================================
-- Phase 8b helpers: list classes/teachers for attendance UI
-- (profiles RLS blocks non-admins from reading other staff — use definer RPCs)
--
-- Note: RETURNS TABLE column names (id, name, …) are variables in plpgsql.
-- Always qualify table columns (p.id, ay.id, c.id) to avoid ambiguity.
-- ===========================================================================

create or replace function public.list_classes_for_attendance()
returns table (
  id                   uuid,
  name                 text,
  grade_name           text,
  sort_order           int,
  homeroom_teacher_id  uuid,
  homeroom_teacher_name text,
  access_reason        text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_school_id uuid := public.current_user_school_id();
  v_year_id   uuid;
  v_uid       uuid := auth.uid();
  v_role      public.staff_role;
  v_is_office boolean;
begin
  if v_uid is null or v_school_id is null then
    return;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_uid and p.is_active and p.school_id = v_school_id;

  if v_role is null then
    return;
  end if;

  v_is_office := v_role in ('administrator', 'headteacher', 'secretary');

  select ay.id into v_year_id
  from public.academic_years ay
  where ay.school_id = v_school_id and ay.is_current
  limit 1;

  if v_year_id is null then
    return;
  end if;

  return query
  select
    c.id,
    c.name,
    coalesce(gl.name, c.name)::text as grade_name,
    coalesce(gl.sort_order, 0)::int as sort_order,
    c.homeroom_teacher_id,
    ht.full_name::text as homeroom_teacher_name,
    (case
      when v_is_office then 'office'
      when c.homeroom_teacher_id = v_uid then 'homeroom'
      else 'cover'
    end)::text as access_reason
  from public.classes c
  join public.grade_levels gl on gl.id = c.grade_level_id
  left join public.profiles ht on ht.id = c.homeroom_teacher_id
  where c.school_id = v_school_id
    and c.academic_year_id = v_year_id
    and c.is_active
    and (
      v_is_office
      or c.homeroom_teacher_id = v_uid
      or exists (
        select 1 from public.class_attendance_covers cov
        where cov.class_id = c.id
          and cov.staff_id = v_uid
          and cov.is_active
          and cov.valid_from <= current_date
          and (cov.valid_until is null or cov.valid_until >= current_date)
      )
    )
  order by gl.sort_order, c.name;
end;
$$;

create or replace function public.list_teachers_for_cover()
returns table (
  id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.school_id = public.current_user_school_id()
    and p.is_active
    and p.role = 'teacher'
    and public.can_manage_attendance_covers()
  order by p.full_name;
$$;

create or replace function public.set_class_homeroom_teacher(
  p_class_id  uuid,
  p_staff_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
begin
  if not public.can_manage_attendance_covers() then
    raise exception 'You are not authorized to set the homeroom teacher.';
  end if;

  if not exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.school_id = v_school_id and c.is_active
  ) then
    raise exception 'Class was not found.';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_staff_id
      and p.school_id = v_school_id
      and p.is_active
      and p.role = 'teacher'
  ) then
    raise exception 'Homeroom must be an active teacher at this school.';
  end if;

  update public.classes c
  set homeroom_teacher_id = p_staff_id
  where c.id = p_class_id and c.school_id = v_school_id;
end;
$$;
