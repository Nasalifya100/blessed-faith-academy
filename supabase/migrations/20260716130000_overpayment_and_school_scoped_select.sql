-- ===========================================================================
-- Sprint 3: Overpayment guard + school-scoped config SELECT (M3, M4)
--
-- File: 20260716130000_overpayment_and_school_scoped_select.sql
--
-- M3 — Reject payments that exceed outstanding balance (no accidental credit)
-- M4 — Scope schools / years / terms / grades / classes SELECT to the caller's school
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- M3: record_payment — cap amount at outstanding balance
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_student_id       uuid,
  p_amount           numeric,
  p_method           public.payment_method,
  p_idempotency_key  uuid,
  p_reference_number text default null,
  p_paid_on          date default ((now() at time zone 'Africa/Lusaka')::date),
  p_notes            text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id      uuid := public.current_user_school_id();
  v_prefix         text;
  v_year           text;
  v_head           text;
  v_seq            int;
  v_receipt_number text;
  v_payment_id     uuid;
  v_charged        numeric(12, 2);
  v_paid           numeric(12, 2);
  v_outstanding    numeric(12, 2);
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to record payments.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  if p_idempotency_key is null then
    raise exception 'An idempotency key is required to record a payment.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  -- Idempotent replay (same school + key → original payment).
  select p.id
  into v_payment_id
  from public.payments as p
  where p.school_id = v_school_id
    and p.idempotency_key = p_idempotency_key;

  if v_payment_id is not null then
    return v_payment_id;
  end if;

  if not exists (
    select 1
    from public.students as s
    where s.id = p_student_id
      and s.school_id = v_school_id
      and s.status = 'enrolled'::public.student_status
  ) then
    raise exception 'Student was not found or is not enrolled.';
  end if;

  select coalesce(sum(c.amount), 0)
  into v_charged
  from public.charges as c
  where c.student_id = p_student_id
    and c.school_id = v_school_id
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    );

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments as p
  where p.student_id = p_student_id
    and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status;

  v_outstanding := v_charged - v_paid;

  if v_outstanding <= 0 then
    raise exception 'This student has no outstanding balance.';
  end if;

  if p_amount > v_outstanding then
    raise exception
      'Payment amount (K%) exceeds outstanding balance (K%). Partial payments are allowed up to the balance.',
      p_amount, v_outstanding;
  end if;

  select coalesce(sch.receipt_prefix, 'R')
  into v_prefix
  from public.schools as sch
  where sch.id = v_school_id;

  select ay.name
  into v_year
  from public.academic_years as ay
  where ay.school_id = v_school_id
    and ay.is_current
  limit 1;

  if v_year is null then
    v_year := to_char((now() at time zone 'Africa/Lusaka')::date, 'YYYY');
  end if;

  v_head := v_prefix || '-' || v_year;

  perform 1
  from public.payments as p
  where p.school_id = v_school_id
    and p.receipt_number ~ ('^' || v_head || '-[0-9]+$')
  for update of p;

  select coalesce(max((regexp_replace(p.receipt_number, '^.*-', ''))::int), 0) + 1
  into v_seq
  from public.payments as p
  where p.school_id = v_school_id
    and p.receipt_number ~ ('^' || v_head || '-[0-9]+$');

  v_receipt_number := v_head || '-' || lpad(v_seq::text, 4, '0');

  begin
    insert into public.payments (
      school_id,
      student_id,
      amount,
      method,
      reference_number,
      receipt_number,
      paid_on,
      notes,
      status,
      recorded_by,
      idempotency_key
    ) values (
      v_school_id,
      p_student_id,
      p_amount,
      p_method,
      nullif(p_reference_number, ''),
      v_receipt_number,
      coalesce(p_paid_on, (now() at time zone 'Africa/Lusaka')::date),
      nullif(p_notes, ''),
      'completed'::public.payment_status,
      auth.uid(),
      p_idempotency_key
    )
    returning id into v_payment_id;
  exception
    when unique_violation then
      select p.id
      into v_payment_id
      from public.payments as p
      where p.school_id = v_school_id
        and p.idempotency_key = p_idempotency_key;

      if v_payment_id is not null then
        return v_payment_id;
      end if;

      raise;
  end;

  return v_payment_id;
end;
$$;

comment on function public.record_payment(uuid, numeric, public.payment_method, uuid, text, date, text) is
  'Records a completed payment up to outstanding balance. Requires idempotency key. Replay returns original id.';

-- ---------------------------------------------------------------------------
-- M4: School-scoped SELECT on core config
-- ---------------------------------------------------------------------------
drop policy if exists "schools_select" on public.schools;
create policy "schools_select" on public.schools
  for select to authenticated
  using (id = public.current_user_school_id());

drop policy if exists "academic_years_select" on public.academic_years;
create policy "academic_years_select" on public.academic_years
  for select to authenticated
  using (school_id = public.current_user_school_id());

drop policy if exists "terms_select" on public.terms;
create policy "terms_select" on public.terms
  for select to authenticated
  using (
    exists (
      select 1
      from public.academic_years as ay
      where ay.id = academic_year_id
        and ay.school_id = public.current_user_school_id()
    )
  );

drop policy if exists "grade_levels_select" on public.grade_levels;
create policy "grade_levels_select" on public.grade_levels
  for select to authenticated
  using (school_id = public.current_user_school_id());

drop policy if exists "classes_select" on public.classes;
create policy "classes_select" on public.classes
  for select to authenticated
  using (school_id = public.current_user_school_id());
