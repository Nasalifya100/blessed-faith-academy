-- ===========================================================================
-- Fix: ambiguous "id" in list_classes_for_attendance (RETURNS TABLE clash)
-- Re-applies the corrected function from 20260715240100.
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
