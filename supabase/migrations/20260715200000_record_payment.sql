-- ===========================================================================
-- Phase 4d: Record a payment and assign a receipt number
--
-- record_payment(...) inserts a completed payment for a student, generates the
-- next receipt number (e.g. BFA-R-2026-0001) inside the same transaction, and
-- returns the payment id. Payment methods: mobile_money | bank_transfer only.
-- ===========================================================================

create or replace function public.record_payment(
  p_student_id       uuid,
  p_amount           numeric,
  p_method           public.payment_method,
  p_reference_number text default null,
  p_paid_on          date default current_date,
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
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to record payments.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if not exists (
    select 1 from public.students
    where id = p_student_id
      and school_id = v_school_id
      and status = 'enrolled'
  ) then
    raise exception 'Student was not found or is not enrolled.';
  end if;

  select coalesce(receipt_prefix, 'R') into v_prefix
  from public.schools where id = v_school_id;

  select name into v_year
  from public.academic_years
  where school_id = v_school_id and is_current
  limit 1;

  if v_year is null then
    v_year := to_char(current_date, 'YYYY');
  end if;

  v_head := v_prefix || '-' || v_year;

  -- Lock the school's payment rows that match this receipt pattern so two
  -- cashiers cannot get the same next number at the same time.
  perform 1
  from public.payments
  where school_id = v_school_id
    and receipt_number ~ ('^' || v_head || '-[0-9]+$')
  for update;

  select coalesce(max((regexp_replace(receipt_number, '^.*-', ''))::int), 0) + 1
  into v_seq
  from public.payments
  where school_id = v_school_id
    and receipt_number ~ ('^' || v_head || '-[0-9]+$');

  v_receipt_number := v_head || '-' || lpad(v_seq::text, 4, '0');

  insert into public.payments (
    school_id, student_id, amount, method, reference_number,
    receipt_number, paid_on, notes, status, recorded_by
  ) values (
    v_school_id, p_student_id, p_amount, p_method,
    nullif(p_reference_number, ''),
    v_receipt_number,
    coalesce(p_paid_on, current_date),
    nullif(p_notes, ''),
    'completed',
    auth.uid()
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;
