-- ===========================================================================
-- Controlled correction of one receipt date.
--
-- Does not correct any existing receipt. The operator supplies a verified
-- date later, one payment at a time, through correct_payment_paid_on.
--
-- payments_enforce_immutability stays in force. The only new escape is the
-- transaction-local GUC app.allow_payment_paid_on_correction, set inside
-- this function. A void still uses app.allow_payment_void and still requires
-- paid_on to stay unchanged, so a bad historical date does not block reversal.
--
-- A voided payment is refused. Repeating the stored date is refused.
-- Once an account has an opening-balance date, a correction that would move
-- the receipt from one side of that date to the other is refused, because
-- that changes the physical balance. Same-side corrections remain possible
-- and still move report periods. While the opening date is null, the
-- physical total includes every attributed receipt, so a date change does
-- not cross a cutover.
-- ===========================================================================

create or replace function public.payments_enforce_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rejection text;
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
       and new.financial_account_id is not distinct from old.financial_account_id
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

  if current_setting('app.allow_payment_paid_on_correction', true) = 'on' then
    v_rejection := public.payment_paid_on_rejection(new.paid_on);
    if v_rejection is not null then
      raise exception '%', v_rejection;
    end if;

    if new.paid_on is distinct from old.paid_on
       and new.amount = old.amount
       and new.currency = old.currency
       and new.method = old.method
       and new.receipt_number = old.receipt_number
       and new.student_id = old.student_id
       and new.school_id = old.school_id
       and new.status = old.status
       and new.financial_account_id is not distinct from old.financial_account_id
       and new.recorded_by is not distinct from old.recorded_by
       and new.reference_number is not distinct from old.reference_number
       and new.notes is not distinct from old.notes
       and new.idempotency_key is not distinct from old.idempotency_key
       and new.void_reason is not distinct from old.void_reason
       and new.voided_at is not distinct from old.voided_at
       and new.voided_by is not distinct from old.voided_by
    then
      return new;
    end if;

    raise exception 'Invalid payment date correction.';
  end if;

  raise exception
    'Payments are immutable. Use public.void_payment to reverse a completed payment.';
end;
$$;

comment on function public.payments_enforce_immutability() is
  'BEFORE UPDATE guard. Void freezes paid_on. Date correction may change only paid_on, and only while the correction function holds its transaction-local setting.';

alter table public.finance_event_audits
  drop constraint if exists finance_event_audits_event_type_check;

alter table public.finance_event_audits
  add constraint finance_event_audits_event_type_check check (
    event_type in (
      'payment_recorded',
      'allocation_created',
      'advance_credit_created',
      'credit_applied',
      'payment_voided',
      'allocations_reversed',
      'historical_backfill',
      'optional_charge_cancelled',
      'ledger_entry_posted',
      'ledger_entry_reversed',
      'expense_recorded',
      'expense_approved',
      'expense_paid',
      'expense_reversed',
      'transfer_recorded',
      'transfer_reversed',
      'salary_recorded',
      'salary_approved',
      'salary_paid',
      'salary_reversed',
      'fund_created',
      'fund_updated',
      'account_created',
      'account_updated',
      'payment_date_corrected'
    )
  );

create or replace function public.correct_payment_paid_on(
  p_payment_id uuid,
  p_corrected_paid_on date,
  p_reason text,
  p_source_reference text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_source text := btrim(coalesce(p_source_reference, ''));
  v_rejection text;
  v_cutover date;
  v_id uuid;
  v_actor uuid := auth.uid();
begin
  if p_payment_id is null then
    raise exception 'A payment is required.';
  end if;
  if length(v_reason) < 3 then
    raise exception 'A correction reason is required.';
  end if;
  if length(v_source) < 3 then
    raise exception 'A source reference for the corrected date is required.';
  end if;

  v_rejection := public.payment_paid_on_rejection(p_corrected_paid_on);
  if v_rejection is not null then
    raise exception '%', v_rejection;
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if v_payment.id is null then
    raise exception 'Payment was not found.';
  end if;

  if v_actor is not null then
    if public.current_user_school_id() is distinct from v_payment.school_id then
      raise exception 'The payment belongs to a different school.';
    end if;
    if not public.has_finance_capability('FINANCE_SETUP_MANAGE') then
      raise exception 'You are not authorized to correct a payment date.';
    end if;
  end if;

  if v_payment.status is distinct from 'completed'::public.payment_status then
    raise exception 'Only a completed payment can have its date corrected.';
  end if;

  if v_payment.paid_on = p_corrected_paid_on then
    raise exception 'The payment is already dated on that day.';
  end if;

  if v_payment.financial_account_id is not null then
    select a.opening_balance_date
      into v_cutover
    from public.financial_accounts a
    where a.id = v_payment.financial_account_id
    for update;

    if v_cutover is not null
       and (v_payment.paid_on <= v_cutover)
           is distinct from (p_corrected_paid_on <= v_cutover) then
      raise exception
        'This correction would move the receipt across the account opening-balance date and change the physical balance.';
    end if;
  end if;

  perform set_config('app.allow_payment_paid_on_correction', 'on', true);

  update public.payments
  set paid_on = p_corrected_paid_on
  where id = v_payment.id
  returning id into v_id;

  perform set_config('app.allow_payment_paid_on_correction', '', true);

  if v_id is null then
    raise exception 'The payment date was not corrected.';
  end if;

  perform public.log_finance_event(
    v_payment.school_id,
    v_payment.student_id,
    'payment_date_corrected',
    v_payment.id,
    null,
    null,
    v_payment.amount,
    v_actor,
    v_reason,
    jsonb_build_object(
      'receipt_number', v_payment.receipt_number,
      'old_paid_on', v_payment.paid_on,
      'new_paid_on', p_corrected_paid_on,
      'source_reference', v_source,
      'actor_context', case
        when v_actor is null then 'database_operator'
        else 'signed_in_session'
      end,
      'amount_unchanged', v_payment.amount,
      'financial_account_unchanged', v_payment.financial_account_id,
      'status_unchanged', v_payment.status
    )
  );

  return v_id;
exception
  when others then
    perform set_config('app.allow_payment_paid_on_correction', '', true);
    raise;
end;
$$;

comment on function public.correct_payment_paid_on(uuid, date, text, text) is
  'Database-owner correction of one completed payment paid_on. Revoked from portal and service roles. A null auth.uid() is recorded as database_operator, not as a portal user. Refuses a voided payment, a same-date no-op, and a move across an existing opening-balance date. Does not change amount, pupil, receipt, method, account, status, or allocations.';

revoke all on function public.correct_payment_paid_on(uuid, date, text, text)
  from public, anon, authenticated, service_role;
