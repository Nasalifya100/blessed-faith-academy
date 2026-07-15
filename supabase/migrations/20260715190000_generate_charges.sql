-- ===========================================================================
-- Phase 4c: Generate term charges for a student or a whole class
--
-- create_charges_for_student(student_id, term_id):
--   * Tuition for the given term (from the student's class grade)
--   * Mandatory year extras once per academic year (report book, PTA,
--     maintenance) if not already charged
--   * Skips optional meals/uniforms (those are opted into later)
--   * Never creates a duplicate of the same fee_item + term/year for a student
--
-- create_charges_for_class(class_id, term_id):
--   Runs the above for every actively enrolled student in that class.
--
-- Returns the number of charge rows created.
-- ===========================================================================

create or replace function public.create_charges_for_student(
  p_student_id uuid,
  p_term_id    uuid default null
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_term_id          uuid;
  v_academic_year_id uuid;
  v_grade_level_id   uuid;
  v_created          int := 0;
  v_item             record;
  v_amount           numeric(12, 2);
  v_exists           boolean;
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to generate charges.';
  end if;

  -- Resolve term (default: current term for this school)
  if p_term_id is not null then
    select t.id, t.academic_year_id
    into v_term_id, v_academic_year_id
    from public.terms t
    join public.academic_years ay on ay.id = t.academic_year_id
    where t.id = p_term_id and ay.school_id = v_school_id;
  else
    select t.id, t.academic_year_id
    into v_term_id, v_academic_year_id
    from public.terms t
    join public.academic_years ay on ay.id = t.academic_year_id
    where ay.school_id = v_school_id and t.is_current
    limit 1;
  end if;

  if v_term_id is null then
    raise exception 'No current term found. Please choose a term.';
  end if;

  -- Confirm student belongs to this school and is enrolled
  if not exists (
    select 1 from public.students
    where id = p_student_id
      and school_id = v_school_id
      and status = 'enrolled'
  ) then
    raise exception 'Student was not found or is not enrolled.';
  end if;

  -- Grade from this year's class placement
  select c.grade_level_id into v_grade_level_id
  from public.student_class_enrollments e
  join public.classes c on c.id = e.class_id
  where e.student_id = p_student_id
    and e.academic_year_id = v_academic_year_id
    and e.status = 'active'
  limit 1;

  if v_grade_level_id is null then
    raise exception 'Student has no active class enrolment for this academic year.';
  end if;

  -- Mandatory (non-optional) fee items
  for v_item in
    select fi.id, fi.code, fi.name, fi.billing_frequency
    from public.fee_items fi
    where fi.school_id = v_school_id
      and fi.is_active
      and not fi.is_optional
    order by fi.sort_order
  loop
    if v_item.billing_frequency = 'term' then
      -- One tuition (etc.) charge per term
      select exists (
        select 1 from public.charges
        where student_id = p_student_id
          and fee_item_id = v_item.id
          and term_id = v_term_id
          and status <> 'cancelled'
      ) into v_exists;

      if v_exists then
        continue;
      end if;

      select fs.amount into v_amount
      from public.fee_schedules fs
      where fs.fee_item_id = v_item.id
        and fs.academic_year_id = v_academic_year_id
        and fs.is_active
        and (fs.grade_level_id = v_grade_level_id or fs.grade_level_id is null)
      order by fs.grade_level_id nulls last
      limit 1;

      if v_amount is null then
        continue;
      end if;

      insert into public.charges (
        school_id, student_id, fee_item_id, academic_year_id, term_id,
        amount, description, status, created_by
      ) values (
        v_school_id, p_student_id, v_item.id, v_academic_year_id, v_term_id,
        v_amount, v_item.name || ' — current term', 'outstanding', auth.uid()
      );
      v_created := v_created + 1;

    else
      -- Year / once extras: one charge per academic year (no term)
      select exists (
        select 1 from public.charges
        where student_id = p_student_id
          and fee_item_id = v_item.id
          and academic_year_id = v_academic_year_id
          and status <> 'cancelled'
      ) into v_exists;

      if v_exists then
        continue;
      end if;

      select fs.amount into v_amount
      from public.fee_schedules fs
      where fs.fee_item_id = v_item.id
        and fs.academic_year_id = v_academic_year_id
        and fs.is_active
        and (fs.grade_level_id = v_grade_level_id or fs.grade_level_id is null)
      order by fs.grade_level_id nulls last
      limit 1;

      if v_amount is null then
        continue;
      end if;

      insert into public.charges (
        school_id, student_id, fee_item_id, academic_year_id, term_id,
        amount, description, status, created_by
      ) values (
        v_school_id, p_student_id, v_item.id, v_academic_year_id, null,
        v_amount, v_item.name || ' — academic year', 'outstanding', auth.uid()
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;

create or replace function public.create_charges_for_class(
  p_class_id uuid,
  p_term_id  uuid default null
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_student   record;
  v_total     int := 0;
  v_count     int;
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to generate charges.';
  end if;

  if not exists (
    select 1 from public.classes
    where id = p_class_id and school_id = v_school_id
  ) then
    raise exception 'Class was not found.';
  end if;

  for v_student in
    select e.student_id
    from public.student_class_enrollments e
    join public.students s on s.id = e.student_id
    where e.class_id = p_class_id
      and e.status = 'active'
      and s.status = 'enrolled'
  loop
    v_count := public.create_charges_for_student(v_student.student_id, p_term_id);
    v_total := v_total + v_count;
  end loop;

  return v_total;
end;
$$;
