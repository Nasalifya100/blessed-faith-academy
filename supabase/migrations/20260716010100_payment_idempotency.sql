-- ===========================================================================
-- Sprint 1 (Financial integrity) — payment recording idempotency
--
-- File: 20260716010100_payment_idempotency.sql
-- Prerequisite: 20260716010000_payment_immutability_and_void.sql
--
-- Goals:
--   * Client supplies a UUID per payment attempt (not UI-button-only).
--   * UNIQUE (school_id, idempotency_key) when key is present.
--   * Repeating the same key returns the original payment id — no second row.
--   * Existing payment rows are preserved (idempotency_key stays NULL).
--   * Cash remains unavailable; methods stay mobile_money | bank_transfer.
--
-- SECURITY:
--   * record_payment remains SECURITY INVOKER so RLS payments_insert applies.
--   * search_path = public on all replaced functions.
--   * Authorization still via public.can_manage_fees().
--   * Idempotency_key is immutable after insert (void path freezes it too).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Column + unique constraint (partial — legacy NULLs allowed)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists idempotency_key uuid;

comment on column public.payments.idempotency_key is
  'Client-generated request UUID for idempotent recording. Unique per school when not null. Legacy rows may be null.';

create unique index if not exists payments_school_idempotency_key_uidx
  on public.payments (school_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Refresh immutability trigger to freeze idempotency_key on void
--    (Column did not exist when migration 1 was written.)
-- ---------------------------------------------------------------------------
create or replace function public.payments_enforce_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_payment_void', true) = 'on' then
    if old.status = 'completed'::public.payment_status
       and new.status = 'voided'::public.payment_status
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
    'Payments are immutable. Use public.void_payment to reverse a completed payment.';
end;
$$;

comment on function public.payments_enforce_immutability() is
  'SECURITY: BEFORE UPDATE guard. Void path freezes financial fields and idempotency_key.';

-- ---------------------------------------------------------------------------
-- 3. record_payment — requires idempotency key; replay-safe
-- ---------------------------------------------------------------------------
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
  -- Authorization: DB is the boundary (UI is not enough).
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
    v_year := to_char(current_date, 'YYYY');
  end if;

  v_head := v_prefix || '-' || v_year;

  -- Serialize receipt sequence for this school + year prefix.
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
      coalesce(p_paid_on, current_date),
      nullif(p_notes, ''),
      'completed'::public.payment_status,
      auth.uid(),
      p_idempotency_key
    )
    returning id into v_payment_id;
  exception
    when unique_violation then
      -- Concurrent insert with the SAME idempotency key: return winner.
      select p.id
      into v_payment_id
      from public.payments as p
      where p.school_id = v_school_id
        and p.idempotency_key = p_idempotency_key;

      if v_payment_id is not null then
        return v_payment_id;
      end if;

      -- Otherwise (e.g. receipt_number clash with a different key): fail loudly.
      raise;
  end;

  return v_payment_id;
end;
$$;

comment on function public.record_payment(uuid, numeric, public.payment_method, uuid, text, date, text) is
  'Records a completed payment. Requires idempotency key. Replay of the same school+key returns the original payment id. INVOKER + RLS.';

-- Remove pre-idempotency overload so callers cannot bypass the key.
drop function if exists public.record_payment(
  uuid,
  numeric,
  public.payment_method,
  text,
  date,
  text
);

revoke all on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) from public;
revoke all on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) from anon;
grant execute on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) to authenticated;
