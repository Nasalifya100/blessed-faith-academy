-- ===========================================================================
-- Finance upgrade — Stage 4: mutating RPCs
--
-- Every function here is SECURITY DEFINER with a locked search_path, and
-- every one of them:
--   1. rejects anonymous callers
--   2. resolves the school from the caller, never from a parameter
--   3. checks an explicit finance capability
--   4. re-validates that referenced funds/accounts belong to that school
--   5. validates the amount and the state transition
--
-- No function accepts a school_id argument, so cross-school injection is not
-- expressible (FIN-16).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared guard
-- ---------------------------------------------------------------------------

create or replace function public.finance_require(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  v_school_id := public.current_user_school_id();
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if not public.has_finance_capability(p_capability) then
    raise exception 'You are not authorized to perform this financial action.';
  end if;
  return v_school_id;
end;
$$;

revoke all on function public.finance_require(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: post one ledger entry. Never granted to clients.
-- ---------------------------------------------------------------------------

create or replace function public.finance_post_entry(
  p_school_id uuid,
  p_entry_date date,
  p_entry_type public.finance_entry_type,
  p_amount numeric,
  p_fund_id uuid,
  p_account_id uuid,
  p_description text,
  p_reference text default null,
  p_payee text default null,
  p_source_type public.finance_source_type default 'manual',
  p_source_id uuid default null,
  p_student_id uuid default null,
  p_staff_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_amount numeric(12, 2) := round(coalesce(p_amount, 0), 2);
  v_direction public.finance_direction;
begin
  if v_amount <= 0 then
    raise exception 'The amount must be greater than zero.';
  end if;

  v_direction := case p_entry_type
    when 'income'::public.finance_entry_type then 'in'
    when 'transfer_in'::public.finance_entry_type then 'in'
    else 'out'
  end::public.finance_direction;

  insert into public.finance_ledger_entries (
    school_id, entry_date, entry_type, direction, amount,
    fund_id, account_id, description, reference, payee,
    source_type, source_id, student_id, staff_id, recorded_by
  ) values (
    p_school_id,
    coalesce(p_entry_date, (now() at time zone 'Africa/Lusaka')::date),
    p_entry_type, v_direction, v_amount,
    p_fund_id, p_account_id, btrim(p_description),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_payee, '')), ''),
    p_source_type, p_source_id, p_student_id, p_staff_id, auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.finance_post_entry(
  uuid, date, public.finance_entry_type, numeric, uuid, uuid, text, text, text,
  public.finance_source_type, uuid, uuid, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: reverse one ledger entry by posting its mirror. Never granted.
-- ---------------------------------------------------------------------------

create or replace function public.finance_reverse_entry(
  p_entry_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.finance_ledger_entries%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_mirror_direction public.finance_direction;
  v_new_id uuid;
begin
  if v_reason = '' then
    raise exception 'A reason is required to reverse a transaction.';
  end if;

  select * into v_original
  from public.finance_ledger_entries e
  where e.id = p_entry_id
  for update of e;

  if v_original.id is null then
    raise exception 'The transaction was not found.';
  end if;
  if v_original.is_reversal then
    raise exception 'A reversal cannot itself be reversed.';
  end if;
  if v_original.reversed_at is not null then
    raise exception 'This transaction has already been reversed.';
  end if;

  v_mirror_direction := case v_original.direction
    when 'in'::public.finance_direction then 'out'
    else 'in'
  end::public.finance_direction;

  insert into public.finance_ledger_entries (
    school_id, entry_date, entry_type, direction, amount,
    fund_id, account_id, description, reference, payee,
    source_type, source_id, student_id, staff_id, recorded_by,
    is_reversal, reverses_entry_id
  ) values (
    v_original.school_id,
    (now() at time zone 'Africa/Lusaka')::date,
    v_original.entry_type, v_mirror_direction, v_original.amount,
    v_original.fund_id, v_original.account_id,
    'Reversal of: ' || v_original.description,
    v_original.reference, v_original.payee,
    v_original.source_type, v_original.source_id,
    v_original.student_id, v_original.staff_id, auth.uid(),
    true, v_original.id
  ) returning id into v_new_id;

  perform set_config('app.allow_ledger_reversal', 'on', true);
  update public.finance_ledger_entries
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_reason
  where id = v_original.id;
  perform set_config('app.allow_ledger_reversal', 'off', true);

  perform public.log_finance_event(
    v_original.school_id, v_original.student_id, 'ledger_entry_reversed',
    null, null, null, v_original.amount, auth.uid(), v_reason,
    jsonb_build_object(
      'original_entry_id', v_original.id,
      'reversal_entry_id', v_new_id,
      'entry_type', v_original.entry_type,
      'source_type', v_original.source_type
    )
  );

  return v_new_id;
end;
$$;

revoke all on function public.finance_reverse_entry(uuid, text)
  from public, anon, authenticated;

-- ===========================================================================
-- Non-student income (tuck shop takings, uniform sales, donations, hire)
-- ===========================================================================

create or replace function public.record_fund_income(
  p_fund_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_received_on date,
  p_description text,
  p_reference text default null,
  p_payer text default null,
  p_student_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_LEDGER_RECORD');
  v_amount numeric(12, 2) := round(coalesce(p_amount, 0), 2);
  v_entry_id uuid;
  v_fund_code text;
begin
  if v_amount <= 0 then
    raise exception 'The amount must be greater than zero.';
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'A description is required.';
  end if;

  select code into v_fund_code from public.finance_funds f
  where f.id = p_fund_id and f.school_id = v_school_id and f.is_active;
  if v_fund_code is null then
    raise exception 'The selected fund was not found or is not active.';
  end if;

  -- Mandatory school fees are collected through the receipted payment flow,
  -- never as free-form income, so receipts and balances stay authoritative.
  if exists (
    select 1 from public.finance_funds f
    where f.id = p_fund_id and f.is_school_fees
  ) then
    raise exception
      'School fee income must be recorded as a student payment so a receipt is issued.';
  end if;

  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_account_id and a.school_id = v_school_id and a.is_active
  ) then
    raise exception 'The selected account was not found or is not active.';
  end if;

  v_entry_id := public.finance_post_entry(
    v_school_id, p_received_on, 'income'::public.finance_entry_type, v_amount,
    p_fund_id, p_account_id, p_description, p_reference, p_payer,
    'manual'::public.finance_source_type, null, p_student_id, null
  );

  perform public.log_finance_event(
    v_school_id, p_student_id, 'ledger_entry_posted', null, null, null,
    v_amount, auth.uid(), null,
    jsonb_build_object(
      'entry_id', v_entry_id, 'entry_type', 'income', 'fund', v_fund_code
    )
  );

  return v_entry_id;
end;
$$;

revoke all on function public.record_fund_income(
  uuid, uuid, numeric, date, text, text, text, uuid
) from public, anon;
grant execute on function public.record_fund_income(
  uuid, uuid, numeric, date, text, text, text, uuid
) to authenticated;

create or replace function public.reverse_fund_income(
  p_entry_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_REVERSE');
  v_entry public.finance_ledger_entries%rowtype;
begin
  select * into v_entry from public.finance_ledger_entries e
  where e.id = p_entry_id and e.school_id = v_school_id;

  if v_entry.id is null then
    raise exception 'The transaction was not found.';
  end if;
  if v_entry.source_type <> 'manual'::public.finance_source_type then
    raise exception
      'This transaction belongs to another record. Reverse it from that record instead.';
  end if;

  return public.finance_reverse_entry(p_entry_id, p_reason);
end;
$$;

revoke all on function public.reverse_fund_income(uuid, text) from public, anon;
grant execute on function public.reverse_fund_income(uuid, text) to authenticated;

-- ===========================================================================
-- Expenditure
-- ===========================================================================

create or replace function public.record_expense(
  p_category_id uuid,
  p_fund_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_description text,
  p_payee text default null,
  p_payment_method public.disbursement_method default null,
  p_reference text default null,
  p_document_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_EXPENSE_RECORD');
  v_amount numeric(12, 2) := round(coalesce(p_amount, 0), 2);
  v_is_salary boolean;
  v_expense_id uuid;
begin
  if v_amount <= 0 then
    raise exception 'The amount must be greater than zero.';
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'A description is required.';
  end if;

  select is_salary into v_is_salary
  from public.expense_categories c
  where c.id = p_category_id and c.school_id = v_school_id and c.is_active;
  if v_is_salary is null then
    raise exception 'The selected expense category was not found or is not active.';
  end if;
  if v_is_salary then
    raise exception
      'Salary payments must be recorded in Salaries so pay-period controls apply.';
  end if;

  if not exists (
    select 1 from public.finance_funds f
    where f.id = p_fund_id and f.school_id = v_school_id and f.is_active
  ) then
    raise exception 'The selected fund was not found or is not active.';
  end if;

  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_account_id and a.school_id = v_school_id and a.is_active
  ) then
    raise exception 'The selected account was not found or is not active.';
  end if;

  insert into public.expenses (
    school_id, expense_date, amount, category_id, fund_id, account_id,
    description, payee, payment_method, reference, document_reference, notes,
    status, recorded_by
  ) values (
    v_school_id,
    coalesce(p_expense_date, (now() at time zone 'Africa/Lusaka')::date),
    v_amount, p_category_id, p_fund_id, p_account_id,
    btrim(p_description),
    nullif(btrim(coalesce(p_payee, '')), ''),
    p_payment_method,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_document_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    'recorded'::public.expense_status, auth.uid()
  ) returning id into v_expense_id;

  perform public.log_finance_event(
    v_school_id, null, 'expense_recorded', null, null, null,
    v_amount, auth.uid(), null,
    jsonb_build_object('expense_id', v_expense_id)
  );

  return v_expense_id;
end;
$$;

revoke all on function public.record_expense(
  uuid, uuid, uuid, numeric, date, text, text,
  public.disbursement_method, text, text, text
) from public, anon;
grant execute on function public.record_expense(
  uuid, uuid, uuid, numeric, date, text, text,
  public.disbursement_method, text, text, text
) to authenticated;

create or replace function public.approve_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_EXPENSE_APPROVE');
  v_expense public.expenses%rowtype;
begin
  select * into v_expense from public.expenses e
  where e.id = p_expense_id and e.school_id = v_school_id
  for update of e;

  if v_expense.id is null then
    raise exception 'The expense was not found.';
  end if;
  if v_expense.status <> 'recorded'::public.expense_status then
    raise exception 'Only a recorded expense can be approved.';
  end if;
  -- Separation of duties: an approver cannot rubber-stamp their own entry
  -- unless they are the administrator of record.
  if v_expense.recorded_by = auth.uid()
     and not public.has_finance_capability('FINANCE_SETUP_MANAGE') then
    raise exception 'An expense must be approved by someone other than the person who recorded it.';
  end if;

  update public.expenses
  set status = 'approved'::public.expense_status,
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_expense.id;

  perform public.log_finance_event(
    v_school_id, null, 'expense_approved', null, null, null,
    v_expense.amount, auth.uid(), null,
    jsonb_build_object('expense_id', v_expense.id)
  );
end;
$$;

revoke all on function public.approve_expense(uuid) from public, anon;
grant execute on function public.approve_expense(uuid) to authenticated;

create or replace function public.pay_expense(
  p_expense_id uuid,
  p_account_id uuid,
  p_paid_on date default null,
  p_payment_method public.disbursement_method default null,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_EXPENSE_PAY');
  v_expense public.expenses%rowtype;
  v_account_id uuid;
  v_entry_id uuid;
begin
  select * into v_expense from public.expenses e
  where e.id = p_expense_id and e.school_id = v_school_id
  for update of e;

  if v_expense.id is null then
    raise exception 'The expense was not found.';
  end if;
  if v_expense.status = 'paid'::public.expense_status then
    raise exception 'This expense has already been paid.';
  end if;
  if v_expense.status <> 'approved'::public.expense_status then
    raise exception 'An expense must be approved before it can be paid.';
  end if;

  v_account_id := coalesce(p_account_id, v_expense.account_id);
  if not exists (
    select 1 from public.financial_accounts a
    where a.id = v_account_id and a.school_id = v_school_id and a.is_active
  ) then
    raise exception 'The paying account was not found or is not active.';
  end if;

  v_entry_id := public.finance_post_entry(
    v_school_id, coalesce(p_paid_on, v_expense.expense_date),
    'expense'::public.finance_entry_type, v_expense.amount,
    v_expense.fund_id, v_account_id, v_expense.description,
    coalesce(nullif(btrim(coalesce(p_reference, '')), ''), v_expense.reference),
    v_expense.payee,
    'expense'::public.finance_source_type, v_expense.id, null, null
  );

  update public.expenses
  set status = 'paid'::public.expense_status,
      account_id = v_account_id,
      payment_method = coalesce(p_payment_method, payment_method),
      reference = coalesce(nullif(btrim(coalesce(p_reference, '')), ''), reference),
      paid_by = auth.uid(),
      paid_at = now(),
      ledger_entry_id = v_entry_id
  where id = v_expense.id;

  perform public.log_finance_event(
    v_school_id, null, 'expense_paid', null, null, null,
    v_expense.amount, auth.uid(), null,
    jsonb_build_object('expense_id', v_expense.id, 'entry_id', v_entry_id)
  );

  return v_entry_id;
end;
$$;

revoke all on function public.pay_expense(
  uuid, uuid, date, public.disbursement_method, text
) from public, anon;
grant execute on function public.pay_expense(
  uuid, uuid, date, public.disbursement_method, text
) to authenticated;

create or replace function public.reverse_expense(
  p_expense_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_REVERSE');
  v_expense public.expenses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'A reason is required to reverse an expense.';
  end if;

  select * into v_expense from public.expenses e
  where e.id = p_expense_id and e.school_id = v_school_id
  for update of e;

  if v_expense.id is null then
    raise exception 'The expense was not found.';
  end if;
  if v_expense.status = 'reversed'::public.expense_status then
    raise exception 'This expense has already been reversed.';
  end if;

  -- Only a paid expense has moved money, so only a paid expense needs a
  -- ledger reversal. An unpaid one is simply closed out.
  if v_expense.ledger_entry_id is not null then
    perform public.finance_reverse_entry(v_expense.ledger_entry_id, v_reason);
  end if;

  update public.expenses
  set status = 'reversed'::public.expense_status,
      reversed_at = now(),
      reversed_by = auth.uid(),
      reversal_reason = v_reason
  where id = v_expense.id;

  perform public.log_finance_event(
    v_school_id, null, 'expense_reversed', null, null, null,
    v_expense.amount, auth.uid(), v_reason,
    jsonb_build_object('expense_id', v_expense.id)
  );
end;
$$;

revoke all on function public.reverse_expense(uuid, text) from public, anon;
grant execute on function public.reverse_expense(uuid, text) to authenticated;

-- ===========================================================================
-- Transfers between the school's own accounts
-- ===========================================================================

create or replace function public.record_account_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_description text,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_TRANSFER_RECORD');
  v_amount numeric(12, 2) := round(coalesce(p_amount, 0), 2);
  v_date date := coalesce(p_transfer_date, (now() at time zone 'Africa/Lusaka')::date);
  v_description text := btrim(coalesce(p_description, ''));
  v_transfer_id uuid;
  v_out_id uuid;
  v_in_id uuid;
begin
  if v_amount <= 0 then
    raise exception 'The transfer amount must be greater than zero.';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'Choose two different accounts.';
  end if;
  if v_description = '' then
    raise exception 'A description is required.';
  end if;

  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_from_account_id and a.school_id = v_school_id and a.is_active
  ) then
    raise exception 'The source account was not found or is not active.';
  end if;
  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_to_account_id and a.school_id = v_school_id and a.is_active
  ) then
    raise exception 'The destination account was not found or is not active.';
  end if;

  -- Stable lock order prevents deadlocks between concurrent transfers.
  perform pg_advisory_xact_lock(hashtext(v_school_id::text || ':transfer'));

  insert into public.finance_transfers (
    school_id, transfer_date, amount, from_account_id, to_account_id,
    description, reference, recorded_by
  ) values (
    v_school_id, v_date, v_amount, p_from_account_id, p_to_account_id,
    v_description, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid()
  ) returning id into v_transfer_id;

  -- Both legs, one transaction. A partial transfer cannot be committed.
  v_out_id := public.finance_post_entry(
    v_school_id, v_date, 'transfer_out'::public.finance_entry_type, v_amount,
    null, p_from_account_id, v_description, p_reference, null,
    'transfer'::public.finance_source_type, v_transfer_id, null, null
  );
  v_in_id := public.finance_post_entry(
    v_school_id, v_date, 'transfer_in'::public.finance_entry_type, v_amount,
    null, p_to_account_id, v_description, p_reference, null,
    'transfer'::public.finance_source_type, v_transfer_id, null, null
  );

  update public.finance_transfers
  set out_entry_id = v_out_id, in_entry_id = v_in_id
  where id = v_transfer_id;

  perform public.log_finance_event(
    v_school_id, null, 'transfer_recorded', null, null, null,
    v_amount, auth.uid(), null,
    jsonb_build_object(
      'transfer_id', v_transfer_id,
      'out_entry_id', v_out_id,
      'in_entry_id', v_in_id
    )
  );

  return v_transfer_id;
end;
$$;

revoke all on function public.record_account_transfer(
  uuid, uuid, numeric, date, text, text
) from public, anon;
grant execute on function public.record_account_transfer(
  uuid, uuid, numeric, date, text, text
) to authenticated;

create or replace function public.reverse_account_transfer(
  p_transfer_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_REVERSE');
  v_transfer public.finance_transfers%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'A reason is required to reverse a transfer.';
  end if;

  select * into v_transfer from public.finance_transfers t
  where t.id = p_transfer_id and t.school_id = v_school_id
  for update of t;

  if v_transfer.id is null then
    raise exception 'The transfer was not found.';
  end if;
  if v_transfer.reversed_at is not null then
    raise exception 'This transfer has already been reversed.';
  end if;

  -- Both legs are reversed together or the transaction aborts.
  perform public.finance_reverse_entry(v_transfer.out_entry_id, v_reason);
  perform public.finance_reverse_entry(v_transfer.in_entry_id, v_reason);

  update public.finance_transfers
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_reason
  where id = v_transfer.id;

  perform public.log_finance_event(
    v_school_id, null, 'transfer_reversed', null, null, null,
    v_transfer.amount, auth.uid(), v_reason,
    jsonb_build_object('transfer_id', v_transfer.id)
  );
end;
$$;

revoke all on function public.reverse_account_transfer(uuid, text)
  from public, anon;
grant execute on function public.reverse_account_transfer(uuid, text)
  to authenticated;

-- ===========================================================================
-- Salaries
-- ===========================================================================

create or replace function public.record_salary_payment(
  p_staff_id uuid,
  p_period_start date,
  p_period_end date,
  p_period_label text,
  p_gross_amount numeric,
  p_deductions_amount numeric default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SALARY_RECORD');
  v_gross numeric(12, 2) := round(coalesce(p_gross_amount, 0), 2);
  v_deductions numeric(12, 2) := round(coalesce(p_deductions_amount, 0), 2);
  v_id uuid;
begin
  if v_gross <= 0 then
    raise exception 'The gross amount must be greater than zero.';
  end if;
  if v_deductions < 0 then
    raise exception 'Deductions cannot be negative.';
  end if;
  if v_deductions > v_gross then
    raise exception 'Deductions cannot exceed the gross amount.';
  end if;
  if p_period_end < p_period_start then
    raise exception 'The pay period end cannot be before its start.';
  end if;
  if length(btrim(coalesce(p_period_label, ''))) = 0 then
    raise exception 'A pay period label is required.';
  end if;

  if not exists (
    select 1 from public.profiles pr
    where pr.id = p_staff_id and pr.school_id = v_school_id
  ) then
    raise exception 'The selected staff member was not found at your school.';
  end if;

  -- Explicit check so the operator sees a clear message rather than a raw
  -- unique-violation. The partial unique index remains the real guarantee.
  if exists (
    select 1 from public.salary_payments s
    where s.school_id = v_school_id
      and s.staff_id = p_staff_id
      and s.period_start = p_period_start
      and s.period_end = p_period_end
      and s.status <> 'reversed'::public.salary_payment_status
  ) then
    raise exception
      'A salary record already exists for this staff member and pay period.';
  end if;

  insert into public.salary_payments (
    school_id, staff_id, period_start, period_end, period_label,
    gross_amount, deductions_amount, status, notes, recorded_by
  ) values (
    v_school_id, p_staff_id, p_period_start, p_period_end,
    btrim(p_period_label), v_gross, v_deductions,
    'draft'::public.salary_payment_status,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  ) returning id into v_id;

  perform public.log_finance_event(
    v_school_id, null, 'salary_recorded', null, null, null,
    v_gross - v_deductions, auth.uid(), null,
    jsonb_build_object('salary_payment_id', v_id)
  );

  return v_id;
end;
$$;

revoke all on function public.record_salary_payment(
  uuid, date, date, text, numeric, numeric, text
) from public, anon;
grant execute on function public.record_salary_payment(
  uuid, date, date, text, numeric, numeric, text
) to authenticated;

create or replace function public.approve_salary_payment(p_salary_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SALARY_APPROVE');
  v_salary public.salary_payments%rowtype;
begin
  select * into v_salary from public.salary_payments s
  where s.id = p_salary_payment_id and s.school_id = v_school_id
  for update of s;

  if v_salary.id is null then
    raise exception 'The salary record was not found.';
  end if;
  if v_salary.status <> 'draft'::public.salary_payment_status then
    raise exception 'Only a draft salary record can be approved.';
  end if;

  update public.salary_payments
  set status = 'approved'::public.salary_payment_status,
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_salary.id;

  perform public.log_finance_event(
    v_school_id, null, 'salary_approved', null, null, null,
    v_salary.net_amount, auth.uid(), null,
    jsonb_build_object('salary_payment_id', v_salary.id)
  );
end;
$$;

revoke all on function public.approve_salary_payment(uuid) from public, anon;
grant execute on function public.approve_salary_payment(uuid) to authenticated;

create or replace function public.pay_salary_payment(
  p_salary_payment_id uuid,
  p_account_id uuid,
  p_payment_date date default null,
  p_payment_method public.disbursement_method default null,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SALARY_PAY');
  v_salary public.salary_payments%rowtype;
  v_fund_id uuid;
  v_date date := coalesce(p_payment_date, (now() at time zone 'Africa/Lusaka')::date);
  v_entry_id uuid;
begin
  select * into v_salary from public.salary_payments s
  where s.id = p_salary_payment_id and s.school_id = v_school_id
  for update of s;

  if v_salary.id is null then
    raise exception 'The salary record was not found.';
  end if;
  if v_salary.status = 'paid'::public.salary_payment_status then
    raise exception 'This salary has already been paid.';
  end if;
  if v_salary.status <> 'approved'::public.salary_payment_status then
    raise exception 'A salary must be approved before it can be paid.';
  end if;

  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_account_id and a.school_id = v_school_id and a.is_active
  ) then
    raise exception 'The paying account was not found or is not active.';
  end if;

  select id into v_fund_id from public.finance_funds f
  where f.school_id = v_school_id and f.code = 'GENERAL';
  if v_fund_id is null then
    raise exception 'The general running-costs fund is missing. Contact an administrator.';
  end if;

  v_entry_id := public.finance_post_entry(
    v_school_id, v_date, 'expense'::public.finance_entry_type,
    v_salary.net_amount, v_fund_id, p_account_id,
    'Salary — ' || v_salary.period_label,
    nullif(btrim(coalesce(p_reference, '')), ''), null,
    'salary'::public.finance_source_type, v_salary.id, null, v_salary.staff_id
  );

  update public.salary_payments
  set status = 'paid'::public.salary_payment_status,
      account_id = p_account_id,
      payment_date = v_date,
      payment_method = coalesce(p_payment_method, payment_method),
      reference = coalesce(nullif(btrim(coalesce(p_reference, '')), ''), reference),
      paid_by = auth.uid(),
      paid_at = now(),
      ledger_entry_id = v_entry_id
  where id = v_salary.id;

  perform public.log_finance_event(
    v_school_id, null, 'salary_paid', null, null, null,
    v_salary.net_amount, auth.uid(), null,
    jsonb_build_object('salary_payment_id', v_salary.id, 'entry_id', v_entry_id)
  );

  return v_entry_id;
end;
$$;

revoke all on function public.pay_salary_payment(
  uuid, uuid, date, public.disbursement_method, text
) from public, anon;
grant execute on function public.pay_salary_payment(
  uuid, uuid, date, public.disbursement_method, text
) to authenticated;

create or replace function public.reverse_salary_payment(
  p_salary_payment_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SALARY_RECORD');
  v_salary public.salary_payments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.has_finance_capability('FINANCE_REVERSE') then
    raise exception 'You are not authorized to reverse financial records.';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to reverse a salary record.';
  end if;

  select * into v_salary from public.salary_payments s
  where s.id = p_salary_payment_id and s.school_id = v_school_id
  for update of s;

  if v_salary.id is null then
    raise exception 'The salary record was not found.';
  end if;
  if v_salary.status = 'reversed'::public.salary_payment_status then
    raise exception 'This salary record has already been reversed.';
  end if;

  if v_salary.ledger_entry_id is not null then
    perform public.finance_reverse_entry(v_salary.ledger_entry_id, v_reason);
  end if;

  update public.salary_payments
  set status = 'reversed'::public.salary_payment_status,
      reversed_at = now(),
      reversed_by = auth.uid(),
      reversal_reason = v_reason
  where id = v_salary.id;

  perform public.log_finance_event(
    v_school_id, null, 'salary_reversed', null, null, null,
    v_salary.net_amount, auth.uid(), v_reason,
    jsonb_build_object('salary_payment_id', v_salary.id)
  );
end;
$$;

revoke all on function public.reverse_salary_payment(uuid, text)
  from public, anon;
grant execute on function public.reverse_salary_payment(uuid, text)
  to authenticated;

-- ===========================================================================
-- Setup: funds and accounts
-- ===========================================================================

create or replace function public.upsert_finance_fund(
  p_fund_id uuid,
  p_code text,
  p_name text,
  p_description text default null,
  p_is_active boolean default true,
  p_sort_order int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SETUP_MANAGE');
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_name = '' then
    raise exception 'A fund name is required.';
  end if;

  if p_fund_id is null then
    if v_code !~ '^[A-Z][A-Z0-9_]{1,39}$' then
      raise exception 'A fund code must be 2-40 characters: letters, numbers, underscore.';
    end if;
    insert into public.finance_funds (
      school_id, code, name, description, is_active, sort_order, created_by, updated_by
    ) values (
      v_school_id, v_code, v_name,
      nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_is_active, true), coalesce(p_sort_order, 0),
      auth.uid(), auth.uid()
    ) returning id into v_id;

    perform public.log_finance_event(
      v_school_id, null, 'fund_created', null, null, null, null, auth.uid(), null,
      jsonb_build_object('fund_id', v_id, 'code', v_code)
    );
  else
    update public.finance_funds
    set name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_active = coalesce(p_is_active, is_active),
        sort_order = coalesce(p_sort_order, sort_order),
        updated_by = auth.uid()
    where id = p_fund_id and school_id = v_school_id
    returning id into v_id;

    if v_id is null then
      raise exception 'The fund was not found.';
    end if;

    perform public.log_finance_event(
      v_school_id, null, 'fund_updated', null, null, null, null, auth.uid(), null,
      jsonb_build_object('fund_id', v_id)
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_finance_fund(
  uuid, text, text, text, boolean, int
) from public, anon;
grant execute on function public.upsert_finance_fund(
  uuid, text, text, text, boolean, int
) to authenticated;

create or replace function public.upsert_financial_account(
  p_account_id uuid,
  p_code text,
  p_name text,
  p_account_type public.financial_account_type,
  p_description text default null,
  p_masked_reference text default null,
  p_opening_balance numeric default 0,
  p_opening_balance_date date default null,
  p_is_active boolean default true,
  p_sort_order int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SETUP_MANAGE');
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_masked text := nullif(btrim(coalesce(p_masked_reference, '')), '');
  v_id uuid;
begin
  if v_name = '' then
    raise exception 'An account name is required.';
  end if;
  -- Never store a full account number.
  if v_masked is not null and length(v_masked) > 12 then
    raise exception 'Store only the masked tail of an account number (12 characters or fewer).';
  end if;

  if p_account_id is null then
    if v_code !~ '^[A-Z][A-Z0-9_]{1,39}$' then
      raise exception 'An account code must be 2-40 characters: letters, numbers, underscore.';
    end if;
    insert into public.financial_accounts (
      school_id, code, name, account_type, description, masked_reference,
      opening_balance, opening_balance_date, is_active, sort_order,
      created_by, updated_by
    ) values (
      v_school_id, v_code, v_name, p_account_type,
      nullif(btrim(coalesce(p_description, '')), ''), v_masked,
      round(coalesce(p_opening_balance, 0), 2), p_opening_balance_date,
      coalesce(p_is_active, true), coalesce(p_sort_order, 0),
      auth.uid(), auth.uid()
    ) returning id into v_id;

    perform public.log_finance_event(
      v_school_id, null, 'account_created', null, null, null, null, auth.uid(), null,
      jsonb_build_object('account_id', v_id, 'code', v_code)
    );
  else
    update public.financial_accounts
    set name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        masked_reference = v_masked,
        is_active = coalesce(p_is_active, is_active),
        sort_order = coalesce(p_sort_order, sort_order),
        updated_by = auth.uid()
    where id = p_account_id and school_id = v_school_id
    returning id into v_id;

    if v_id is null then
      raise exception 'The account was not found.';
    end if;

    perform public.log_finance_event(
      v_school_id, null, 'account_updated', null, null, null, null, auth.uid(), null,
      jsonb_build_object('account_id', v_id)
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_financial_account(
  uuid, text, text, public.financial_account_type, text, text,
  numeric, date, boolean, int
) from public, anon;
grant execute on function public.upsert_financial_account(
  uuid, text, text, public.financial_account_type, text, text,
  numeric, date, boolean, int
) to authenticated;
