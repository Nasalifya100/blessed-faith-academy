-- ===========================================================================
-- Sprint 1 / Financial integrity: payment recording idempotency
--
-- Client supplies a UUID per payment attempt. Repeating the same key returns
-- the original payment id instead of inserting a duplicate.
-- ===========================================================================

alter table public.payments
  add column if not exists idempotency_key uuid;

comment on column public.payments.idempotency_key is
  'Client-generated request UUID; unique per school when present.';

-- Legacy rows keep NULL; new recordings require a key via record_payment
create unique index if not exists payments_school_idempotency_key_uidx
  on public.payments (school_id, idempotency_key)
  where idempotency_key is not null;

-- Freeze idempotency_key on the void path as well
create or replace function public.payments_enforce_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_payment_void', true) = 'on' then
    if old.status = 'completed'
       and new.status = 'voided'
       and new.amount = old.amount
       and new.currency = old.currency
       and new.method = old.method
       and new.receipt_number = old.receipt_number
       and new.student_id = old.student_id
       and new.school_id = old.school_id
       and new.paid_on = old.paid_on
       and new.recorded_by is not distinct from old.recorded_by
       and new.reference_number is not distinct from old.reference_number
       and new.notes is not distinct from old.notes
       and new.idempotency_key is not distinct from old.idempotency_key
       and new.void_reason is not null
       and length(trim(new.void_reason)) > 0
       and new.voided_at is not null
       and new.voided_by is not null
    then
      return new;
    end if;
    raise exception 'Invalid payment void update.';
  end if;

  raise exception
    'Payments are immutable. Use void_payment to reverse a completed payment.';
end;
$$;

create or replace function public.record_payment(
  p_student_id       uuid,
  p_amount           numeric,
  p_method           public.payment_method,
  p_idempotency_key  uuid,
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

  if p_idempotency_key is null then
    raise exception 'An idempotency key is required to record a payment.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  -- Idempotent replay: return the existing payment for this school + key
  select id into v_payment_id
  from public.payments
  where school_id = v_school_id
    and idempotency_key = p_idempotency_key;

  if v_payment_id is not null then
    return v_payment_id;
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

  begin
    insert into public.payments (
      school_id, student_id, amount, method, reference_number,
      receipt_number, paid_on, notes, status, recorded_by, idempotency_key
    ) values (
      v_school_id, p_student_id, p_amount, p_method,
      nullif(p_reference_number, ''),
      v_receipt_number,
      coalesce(p_paid_on, current_date),
      nullif(p_notes, ''),
      'completed',
      auth.uid(),
      p_idempotency_key
    )
    returning id into v_payment_id;
  exception
    when unique_violation then
      -- Concurrent insert with same idempotency key won the race
      select id into v_payment_id
      from public.payments
      where school_id = v_school_id
        and idempotency_key = p_idempotency_key;

      if v_payment_id is null then
        raise;
      end if;
  end;

  return v_payment_id;
end;
$$;

-- Drop previous overload without idempotency key (if present)
drop function if exists public.record_payment(uuid, numeric, public.payment_method, text, date, text);
