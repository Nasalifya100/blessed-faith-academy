-- ===========================================================================
-- Phase 7a: Optional meal / uniform charges (opt-in)
--
-- create_optional_charge(student_id, fee_item_id, term_id):
--   Creates a charge for an OPTIONAL fee item (meal or uniform) using the
--   current year's schedule amount. Skips if an active charge already exists
--   for the same student + item + term (or year, for once items).
--
-- Returns the new charge id, or null if it already existed.
-- ===========================================================================

create or replace function public.create_optional_charge(
  p_student_id  uuid,
  p_fee_item_id uuid,
  p_term_id     uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id        uuid := public.current_user_school_id();
  v_term_id          uuid;
  v_academic_year_id uuid;
  v_grade_level_id   uuid;
  v_item_name        text;
  v_category         public.fee_category;
  v_is_optional      boolean;
  v_amount           numeric(12, 2);
  v_charge_id        uuid;
  v_exists           boolean;
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to add optional charges.';
  end if;

  select fi.name, fi.category, fi.is_optional
  into v_item_name, v_category, v_is_optional
  from public.fee_items fi
  where fi.id = p_fee_item_id
    and fi.school_id = v_school_id
    and fi.is_active;

  if v_item_name is null then
    raise exception 'Fee item was not found.';
  end if;

  if not v_is_optional then
    raise exception 'This fee is not optional. Use Generate charges for mandatory fees.';
  end if;

  if v_category not in ('meal', 'uniform') then
    raise exception 'Only meal and uniform items can be opted into here.';
  end if;

  -- Resolve term / year
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

  if v_academic_year_id is null then
    raise exception 'No current academic year / term found.';
  end if;

  if not exists (
    select 1 from public.students
    where id = p_student_id and school_id = v_school_id and status = 'enrolled'
  ) then
    raise exception 'Student was not found or is not enrolled.';
  end if;

  select c.grade_level_id into v_grade_level_id
  from public.student_class_enrollments e
  join public.classes c on c.id = e.class_id
  where e.student_id = p_student_id
    and e.academic_year_id = v_academic_year_id
    and e.status = 'active'
  limit 1;

  -- Amount from schedule (grade-specific first, else school-wide)
  select fs.amount into v_amount
  from public.fee_schedules fs
  where fs.fee_item_id = p_fee_item_id
    and fs.academic_year_id = v_academic_year_id
    and fs.is_active
    and (fs.grade_level_id = v_grade_level_id or fs.grade_level_id is null)
  order by fs.grade_level_id nulls last
  limit 1;

  if v_amount is null then
    raise exception 'No price is set for this item in the current year.';
  end if;

  -- Meals: only one meal plan per term (any meal fee item)
  if v_category = 'meal' then
    if v_term_id is null then
      raise exception 'A term is required for this meal plan.';
    end if;

    if exists (
      select 1
      from public.charges c
      join public.fee_items fi on fi.id = c.fee_item_id
      where c.student_id = p_student_id
        and c.term_id = v_term_id
        and c.status <> 'cancelled'
        and fi.category = 'meal'
        and c.fee_item_id = p_fee_item_id
    ) then
      return null;
    end if;

    if exists (
      select 1
      from public.charges c
      join public.fee_items fi on fi.id = c.fee_item_id
      where c.student_id = p_student_id
        and c.term_id = v_term_id
        and c.status <> 'cancelled'
        and fi.category = 'meal'
        and c.fee_item_id <> p_fee_item_id
    ) then
      raise exception
        'This student already has a meal plan for the current term. Cancel that charge first to change it.';
    end if;

    insert into public.charges (
      school_id, student_id, fee_item_id, academic_year_id, term_id,
      amount, description, status, created_by
    ) values (
      v_school_id, p_student_id, p_fee_item_id, v_academic_year_id, v_term_id,
      v_amount, v_item_name || ' (opt-in)', 'outstanding', auth.uid()
    )
    returning id into v_charge_id;

    return v_charge_id;
  end if;

  -- Uniforms (once): one charge per item per academic year
  select exists (
    select 1 from public.charges
    where student_id = p_student_id
      and fee_item_id = p_fee_item_id
      and academic_year_id = v_academic_year_id
      and status <> 'cancelled'
  ) into v_exists;

  if v_exists then
    return null;
  end if;

  insert into public.charges (
    school_id, student_id, fee_item_id, academic_year_id, term_id,
    amount, description, status, created_by
  ) values (
    v_school_id, p_student_id, p_fee_item_id, v_academic_year_id, null,
    v_amount, v_item_name || ' (opt-in)', 'outstanding', auth.uid()
  )
  returning id into v_charge_id;

  return v_charge_id;
end;
$$;
