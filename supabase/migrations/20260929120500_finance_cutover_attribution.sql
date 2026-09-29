-- ===========================================================================
-- Finance pre-commit review — cutover, attribution, idempotency
--
-- Fixes found by adversarial review. Not applied by this change set.
--
-- 1. Physical balances must not guess an account from payment method, and
--    must not add historical receipts on top of an opening balance that
--    already contains them.
-- 2. New student receipts name the account explicitly. Historical receipts
--    stay unassigned and are left inside the opening balance.
-- 3. Repeated submissions of income, expenses, and transfers are idempotent.
-- 4. Salary periods cannot overlap, and self-approval is audited.
-- 5. A newly created school receives the default funds, accounts, and
--    expense categories instead of failing later with a missing fund.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Receipts may name the account that received them. Nullable so every
-- historical receipt stays valid and is not guessed.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists financial_account_id uuid
    references public.financial_accounts(id);

create index if not exists payments_financial_account_idx
  on public.payments (financial_account_id)
  where financial_account_id is not null;

comment on column public.payments.financial_account_id is
  'The physical account that received this receipt. Null means unassigned. Never inferred from payment method.';

comment on column public.financial_accounts.default_for_method is
  'Optional suggestion shown on the payment form. It is not used to calculate a balance.';

comment on column public.financial_accounts.opening_balance_date is
  'End of this day is the cutover. Movements on or before this date are already inside opening_balance and are not added again.';

alter table public.financial_accounts
  drop constraint if exists financial_accounts_opening_nonnegative;

alter table public.financial_accounts
  add constraint financial_accounts_opening_nonnegative
  check (opening_balance >= 0);

-- ---------------------------------------------------------------------------
-- Idempotency keys for non-student postings. A retried form returns the
-- original row instead of posting the money twice.
-- ---------------------------------------------------------------------------

alter table public.finance_ledger_entries
  add column if not exists client_request_id uuid;

create unique index if not exists finance_ledger_client_request_uidx
  on public.finance_ledger_entries (school_id, client_request_id)
  where client_request_id is not null;

alter table public.expenses
  add column if not exists client_request_id uuid;

create unique index if not exists expenses_client_request_uidx
  on public.expenses (school_id, client_request_id)
  where client_request_id is not null;

alter table public.finance_transfers
  add column if not exists client_request_id uuid;

create unique index if not exists finance_transfers_client_request_uidx
  on public.finance_transfers (school_id, client_request_id)
  where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- Opening balance freezes once any movement — ledger or assigned receipt —
-- has touched the account, so it cannot be set on top of money already counted.
-- ---------------------------------------------------------------------------

create or replace function public.financial_account_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'An account code cannot be changed once the account exists.';
  end if;
  if new.account_type is distinct from old.account_type then
    raise exception 'An account type cannot be changed once the account exists.';
  end if;
  if (new.opening_balance is distinct from old.opening_balance
      or new.opening_balance_date is distinct from old.opening_balance_date)
     and (
       exists (
         select 1 from public.finance_ledger_entries e where e.account_id = old.id
       )
       or exists (
         select 1 from public.payments p where p.financial_account_id = old.id
       )
     )
  then
    raise exception
      'The opening balance cannot change once this account has transactions. Record an adjustment instead.';
  end if;
  if new.opening_balance < 0 then
    raise exception 'An opening balance cannot be negative.';
  end if;
  if new.opening_balance_date is not null
     and new.opening_balance_date > (now() at time zone 'Africa/Lusaka')::date
  then
    raise exception 'The opening balance date cannot be in the future.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger rows dated on or before the cutover are rejected, so they cannot
-- sit in the table while being silently left out of the balance.
-- ---------------------------------------------------------------------------

create or replace function public.finance_ledger_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.finance_ledger_entries%rowtype;
  v_opening date;
begin
  if new.fund_id is not null and not exists (
    select 1 from public.finance_funds f
    where f.id = new.fund_id and f.school_id = new.school_id
  ) then
    raise exception 'The selected fund belongs to a different school.';
  end if;

  select a.opening_balance_date into v_opening
  from public.financial_accounts a
  where a.id = new.account_id and a.school_id = new.school_id;
  if v_opening is null and not exists (
    select 1 from public.financial_accounts a
    where a.id = new.account_id and a.school_id = new.school_id
  ) then
    raise exception 'The selected account belongs to a different school.';
  end if;
  if v_opening is not null and new.entry_date <= v_opening then
    raise exception
      'This date is on or before the account opening balance date (%). That money is already inside the opening balance.',
      v_opening;
  end if;

  if new.student_id is not null and not exists (
    select 1 from public.students s
    where s.id = new.student_id and s.school_id = new.school_id
  ) then
    raise exception 'The selected student belongs to a different school.';
  end if;

  if new.reverses_entry_id is not null then
    select * into v_original
    from public.finance_ledger_entries e
    where e.id = new.reverses_entry_id;

    if v_original.id is null then
      raise exception 'The transaction being reversed was not found.';
    end if;
    if v_original.school_id <> new.school_id then
      raise exception 'A transaction can only be reversed within its own school.';
    end if;
    if v_original.is_reversal then
      raise exception 'A reversal cannot itself be reversed.';
    end if;
    if new.entry_type <> v_original.entry_type then
      raise exception 'A reversal must match the type of the original transaction.';
    end if;
    if new.amount <> v_original.amount then
      raise exception 'A reversal must match the amount of the original transaction.';
    end if;
    if new.account_id <> v_original.account_id then
      raise exception 'A reversal must return the money to the original account.';
    end if;
    if new.fund_id is distinct from v_original.fund_id then
      raise exception 'A reversal must apply to the original fund.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Posting accepts an idempotency key. Callers that omit it behave as before.
-- ---------------------------------------------------------------------------

drop function if exists public.finance_post_entry(
  uuid, date, public.finance_entry_type, numeric, uuid, uuid, text, text, text,
  public.finance_source_type, uuid, uuid, uuid
);

create function public.finance_post_entry(
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
  p_staff_id uuid default null,
  p_client_request_id uuid default null
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

  if p_client_request_id is not null then
    select e.id into v_id
    from public.finance_ledger_entries e
    where e.school_id = p_school_id
      and e.client_request_id = p_client_request_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  v_direction := case p_entry_type
    when 'income'::public.finance_entry_type then 'in'
    when 'transfer_in'::public.finance_entry_type then 'in'
    else 'out'
  end::public.finance_direction;

  insert into public.finance_ledger_entries (
    school_id, entry_date, entry_type, direction, amount,
    fund_id, account_id, description, reference, payee,
    source_type, source_id, student_id, staff_id, recorded_by,
    client_request_id
  ) values (
    p_school_id,
    coalesce(p_entry_date, (now() at time zone 'Africa/Lusaka')::date),
    p_entry_type, v_direction, v_amount,
    p_fund_id, p_account_id, btrim(p_description),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_payee, '')), ''),
    p_source_type, p_source_id, p_student_id, p_staff_id, auth.uid(),
    p_client_request_id
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.finance_post_entry(
  uuid, date, public.finance_entry_type, numeric, uuid, uuid, text, text, text,
  public.finance_source_type, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Student receipt -> account. Set only at insert, from an explicit choice.
-- Payment method is never consulted.
-- ---------------------------------------------------------------------------

create or replace function public.payments_assign_financial_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting text := nullif(current_setting('app.payment_financial_account_id', true), '');
  v_account public.financial_accounts%rowtype;
begin
  if new.financial_account_id is null and v_setting is not null then
    new.financial_account_id := v_setting::uuid;
  end if;
  perform set_config('app.payment_financial_account_id', '', true);

  if new.financial_account_id is null then
    return new;
  end if;

  select * into v_account
  from public.financial_accounts a
  where a.id = new.financial_account_id;

  if v_account.id is null or v_account.school_id <> new.school_id then
    raise exception 'The selected account does not belong to this school.';
  end if;
  if not v_account.is_active then
    raise exception 'The selected account is not active.';
  end if;
  if v_account.opening_balance_date is not null
     and new.paid_on <= v_account.opening_balance_date
  then
    raise exception
      'This payment date is on or before the account opening balance date (%). That money is already inside the opening balance.',
      v_account.opening_balance_date;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_assign_financial_account on public.payments;
create trigger payments_assign_financial_account
  before insert on public.payments
  for each row execute function public.payments_assign_financial_account();

create or replace function public.record_payment_to_account(
  p_student_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_idempotency_key uuid,
  p_financial_account_id uuid,
  p_reference_number text default null,
  p_paid_on date default ((now() at time zone 'Africa/Lusaka')::date),
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Same people who record receipts. The inner record_payment repeats
  -- can_manage_fees(); this check keeps the finance capability model in force.
  perform public.finance_require('FINANCE_LEDGER_RECORD');

  if p_financial_account_id is null then
    raise exception 'Choose the account that received this payment.';
  end if;

  perform set_config(
    'app.payment_financial_account_id',
    p_financial_account_id::text,
    true
  );

  v_result := public.record_payment(
    p_student_id,
    p_amount,
    p_method,
    p_idempotency_key,
    p_reference_number,
    p_paid_on,
    p_notes
  );

  perform set_config('app.payment_financial_account_id', '', true);
  return v_result;
exception
  when others then
    perform set_config('app.payment_financial_account_id', '', true);
    raise;
end;
$$;

revoke all on function public.record_payment_to_account(
  uuid, numeric, public.payment_method, uuid, uuid, text, date, text
) from public, anon;
grant execute on function public.record_payment_to_account(
  uuid, numeric, public.payment_method, uuid, uuid, text, date, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Income, with a client request id so a double submit cannot post twice.
-- ---------------------------------------------------------------------------

drop function if exists public.record_fund_income(
  uuid, uuid, numeric, date, text, text, text, uuid
);

create function public.record_fund_income(
  p_fund_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_received_on date,
  p_description text,
  p_reference text default null,
  p_payer text default null,
  p_student_id uuid default null,
  p_client_request_id uuid default null
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
  v_existing_amount numeric(12, 2);
  v_fund_code text;
begin
  if v_amount <= 0 then
    raise exception 'The amount must be greater than zero.';
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'A description is required.';
  end if;

  if p_client_request_id is not null then
    select e.id, e.amount into v_entry_id, v_existing_amount
    from public.finance_ledger_entries e
    where e.school_id = v_school_id
      and e.client_request_id = p_client_request_id;
    if v_entry_id is not null then
      if v_existing_amount <> v_amount then
        raise exception 'This request was already recorded for a different amount.';
      end if;
      return v_entry_id;
    end if;
  end if;

  select code into v_fund_code from public.finance_funds f
  where f.id = p_fund_id and f.school_id = v_school_id and f.is_active;
  if v_fund_code is null then
    raise exception 'The selected fund was not found or is not active.';
  end if;

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

  begin
    v_entry_id := public.finance_post_entry(
      v_school_id, p_received_on, 'income'::public.finance_entry_type, v_amount,
      p_fund_id, p_account_id, p_description, p_reference, p_payer,
      'manual'::public.finance_source_type, null, p_student_id, null,
      p_client_request_id
    );
  exception
    when unique_violation then
      select e.id, e.amount into v_entry_id, v_existing_amount
      from public.finance_ledger_entries e
      where e.school_id = v_school_id
        and e.client_request_id = p_client_request_id;
      if v_entry_id is not null then
        if v_existing_amount <> v_amount then
          raise exception 'This request was already recorded for a different amount.';
        end if;
        return v_entry_id;
      end if;
      raise;
  end;

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
  uuid, uuid, numeric, date, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.record_fund_income(
  uuid, uuid, numeric, date, text, text, text, uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Expenses: idempotent record, and self-approval is written into the audit.
-- ---------------------------------------------------------------------------

drop function if exists public.record_expense(
  uuid, uuid, uuid, numeric, date, text, text,
  public.disbursement_method, text, text, text
);

create function public.record_expense(
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
  p_notes text default null,
  p_client_request_id uuid default null
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
  v_existing_amount numeric(12, 2);
begin
  if v_amount <= 0 then
    raise exception 'The amount must be greater than zero.';
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'A description is required.';
  end if;

  if p_client_request_id is not null then
    select e.id, e.amount into v_expense_id, v_existing_amount
    from public.expenses e
    where e.school_id = v_school_id
      and e.client_request_id = p_client_request_id;
    if v_expense_id is not null then
      if v_existing_amount <> v_amount then
        raise exception 'This request was already recorded for a different amount.';
      end if;
      return v_expense_id;
    end if;
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

  begin
    insert into public.expenses (
      school_id, expense_date, amount, category_id, fund_id, account_id,
      description, payee, payment_method, reference, document_reference, notes,
      status, recorded_by, client_request_id
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
      'recorded'::public.expense_status, auth.uid(),
      p_client_request_id
    ) returning id into v_expense_id;
  exception
    when unique_violation then
      select e.id, e.amount into v_expense_id, v_existing_amount
      from public.expenses e
      where e.school_id = v_school_id
        and e.client_request_id = p_client_request_id;
      if v_expense_id is not null then
        if v_existing_amount <> v_amount then
          raise exception 'This request was already recorded for a different amount.';
        end if;
        return v_expense_id;
      end if;
      raise;
  end;

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
  public.disbursement_method, text, text, text, uuid
) from public, anon;
grant execute on function public.record_expense(
  uuid, uuid, uuid, numeric, date, text, text,
  public.disbursement_method, text, text, text, uuid
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
  v_self boolean;
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

  v_self := v_expense.recorded_by = auth.uid();
  -- A small school may have only one person who can configure finance.
  -- That person may self-approve, and the audit records that fact.
  -- Everyone else must get a second person.
  if v_self and not public.has_finance_capability('FINANCE_SETUP_MANAGE') then
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
    jsonb_build_object(
      'expense_id', v_expense.id,
      'self_approved', v_self
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfers: idempotent, and still both legs or neither.
-- A transfer may take an account below zero. That is deliberate and visible.
-- ---------------------------------------------------------------------------

drop function if exists public.record_account_transfer(
  uuid, uuid, numeric, date, text, text
);

create function public.record_account_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_description text,
  p_reference text default null,
  p_client_request_id uuid default null
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
  v_existing_amount numeric(12, 2);
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

  if p_client_request_id is not null then
    select t.id, t.amount into v_transfer_id, v_existing_amount
    from public.finance_transfers t
    where t.school_id = v_school_id
      and t.client_request_id = p_client_request_id;
    if v_transfer_id is not null then
      if v_existing_amount <> v_amount then
        raise exception 'This request was already recorded for a different amount.';
      end if;
      return v_transfer_id;
    end if;
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

  perform pg_advisory_xact_lock(hashtext(v_school_id::text || ':transfer'));

  begin
    insert into public.finance_transfers (
      school_id, transfer_date, amount, from_account_id, to_account_id,
      description, reference, recorded_by, client_request_id
    ) values (
      v_school_id, v_date, v_amount, p_from_account_id, p_to_account_id,
      v_description, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid(),
      p_client_request_id
    ) returning id into v_transfer_id;
  exception
    when unique_violation then
      select t.id, t.amount into v_transfer_id, v_existing_amount
      from public.finance_transfers t
      where t.school_id = v_school_id
        and t.client_request_id = p_client_request_id;
      if v_transfer_id is not null then
        if v_existing_amount <> v_amount then
          raise exception 'This request was already recorded for a different amount.';
        end if;
        return v_transfer_id;
      end if;
      raise;
  end;

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
  uuid, uuid, numeric, date, text, text, uuid
) from public, anon;
grant execute on function public.record_account_transfer(
  uuid, uuid, numeric, date, text, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Salaries: overlapping periods are a second payment. Self-approval is audited.
-- Bursar may see salaries (they disburse them) but cannot approve them.
-- ---------------------------------------------------------------------------

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

  if exists (
    select 1 from public.salary_payments s
    where s.school_id = v_school_id
      and s.staff_id = p_staff_id
      and s.status <> 'reversed'::public.salary_payment_status
      and daterange(s.period_start, s.period_end, '[]')
          && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception
      'A salary record already covers this pay period for this staff member.';
  end if;

  begin
    insert into public.salary_payments (
      school_id, staff_id, period_start, period_end, period_label,
      gross_amount, deductions_amount, status, notes, recorded_by
    ) values (
      v_school_id, p_staff_id, p_period_start, p_period_end,
      btrim(p_period_label), v_gross, v_deductions,
      'draft'::public.salary_payment_status,
      nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
    ) returning id into v_id;
  exception
    when unique_violation then
      raise exception
        'A salary record already exists for this staff member and pay period.';
  end;

  perform public.log_finance_event(
    v_school_id, null, 'salary_recorded', null, null, null,
    v_gross - v_deductions, auth.uid(), null,
    jsonb_build_object('salary_payment_id', v_id)
  );

  return v_id;
end;
$$;

create or replace function public.approve_salary_payment(p_salary_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.finance_require('FINANCE_SALARY_APPROVE');
  v_salary public.salary_payments%rowtype;
  v_self boolean;
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

  v_self := v_salary.recorded_by = auth.uid();
  if v_self and not public.has_finance_capability('FINANCE_SETUP_MANAGE') then
    raise exception 'A salary must be approved by someone other than the person who recorded it.';
  end if;

  update public.salary_payments
  set status = 'approved'::public.salary_payment_status,
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_salary.id;

  perform public.log_finance_event(
    v_school_id, null, 'salary_approved', null, null, null,
    v_salary.net_amount, auth.uid(), null,
    jsonb_build_object(
      'salary_payment_id', v_salary.id,
      'self_approved', v_self
    )
  );
end;
$$;

-- Salary audit rows are hidden from anyone who cannot see salaries,
-- even if they can otherwise read the finance audit log.
drop policy if exists "finance_event_audits_select" on public.finance_event_audits;
create policy "finance_event_audits_select"
  on public.finance_event_audits
  for select
  to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_manage_fees()
    and (
      event_type not in (
        'salary_recorded',
        'salary_approved',
        'salary_paid',
        'salary_reversed'
      )
      or public.has_finance_capability('FINANCE_SALARY_VIEW')
    )
  );

-- ---------------------------------------------------------------------------
-- Opening balances can be set, until the account has been used.
-- ---------------------------------------------------------------------------

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
  v_opening numeric(12, 2) := round(coalesce(p_opening_balance, 0), 2);
  v_id uuid;
  v_previous numeric(12, 2);
  v_previous_date date;
begin
  if v_name = '' then
    raise exception 'An account name is required.';
  end if;
  if v_masked is not null and length(v_masked) > 12 then
    raise exception 'Store only the masked tail of an account number (12 characters or fewer).';
  end if;
  if v_opening < 0 then
    raise exception 'An opening balance cannot be negative.';
  end if;
  if p_opening_balance_date is null then
    raise exception 'An opening balance needs the date it was true, so later transactions are not counted twice.';
  end if;
  if p_opening_balance_date > (now() at time zone 'Africa/Lusaka')::date then
    raise exception 'The opening balance date cannot be in the future.';
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
      v_opening, p_opening_balance_date,
      coalesce(p_is_active, true), coalesce(p_sort_order, 0),
      auth.uid(), auth.uid()
    ) returning id into v_id;

    perform public.log_finance_event(
      v_school_id, null, 'account_created', null, null, null, v_opening, auth.uid(), null,
      jsonb_build_object(
        'account_id', v_id,
        'code', v_code,
        'opening_balance', v_opening,
        'opening_balance_date', p_opening_balance_date
      )
    );
  else
    select a.opening_balance, a.opening_balance_date
      into v_previous, v_previous_date
    from public.financial_accounts a
    where a.id = p_account_id and a.school_id = v_school_id;

    update public.financial_accounts
    set name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        masked_reference = v_masked,
        opening_balance = v_opening,
        opening_balance_date = p_opening_balance_date,
        is_active = coalesce(p_is_active, is_active),
        sort_order = coalesce(p_sort_order, sort_order),
        updated_by = auth.uid()
    where id = p_account_id and school_id = v_school_id
    returning id into v_id;

    if v_id is null then
      raise exception 'The account was not found.';
    end if;

    perform public.log_finance_event(
      v_school_id, null, 'account_updated', null, null, null, v_opening, auth.uid(), null,
      jsonb_build_object(
        'account_id', v_id,
        'previous_opening_balance', v_previous,
        'previous_opening_balance_date', v_previous_date,
        'opening_balance', v_opening,
        'opening_balance_date', p_opening_balance_date
      )
    );
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances.
--   opening balance (true at the end of opening_balance_date)
-- + ledger movements dated after that date
-- + completed receipts that explicitly name this account and are dated after it
--
-- Receipts with no account, and receipts on or before the cutover, are excluded.
-- Payment method is not consulted.
-- ---------------------------------------------------------------------------

create or replace function public.finance_account_balance(
  p_account_id uuid,
  p_as_of date default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_account public.financial_accounts%rowtype;
  v_ledger numeric(12, 2);
  v_student numeric(12, 2);
begin
  if not public.has_finance_capability('FINANCE_ACCOUNTS_VIEW') then
    raise exception 'You are not authorized to view account balances.';
  end if;

  select * into v_account from public.financial_accounts a
  where a.id = p_account_id and a.school_id = v_school_id;
  if v_account.id is null then
    raise exception 'The account was not found.';
  end if;

  select coalesce(sum(e.account_delta), 0) into v_ledger
  from public.finance_ledger_entries e
  where e.account_id = v_account.id
    and e.school_id = v_school_id
    and (p_as_of is null or e.entry_date <= p_as_of)
    and (
      v_account.opening_balance_date is null
      or e.entry_date > v_account.opening_balance_date
    );

  select coalesce(sum(p.amount), 0) into v_student
  from public.payments p
  where p.school_id = v_school_id
    and p.financial_account_id = v_account.id
    and p.status = 'completed'::public.payment_status
    and (p_as_of is null or p.paid_on <= p_as_of)
    and (
      v_account.opening_balance_date is null
      or p.paid_on > v_account.opening_balance_date
    );

  return (v_account.opening_balance + v_ledger + v_student)::numeric(12, 2);
end;
$$;

create or replace view public.finance_student_fund_income
with (security_invoker = true) as
select
  p.school_id,
  p.paid_on          as entry_date,
  fi.fund_id         as fund_id,
  p.financial_account_id as account_id,
  pa.amount          as amount,
  p.id               as payment_id,
  p.receipt_number   as receipt_number,
  p.student_id       as student_id,
  p.method           as method
from public.payment_allocations pa
join public.payments p on p.id = pa.payment_id
join public.charges c on c.id = pa.charge_id
join public.fee_items fi on fi.id = c.fee_item_id
where pa.reversed_at is null
  and p.status = 'completed'::public.payment_status;

comment on view public.finance_student_fund_income is
  'Receipted student money attributed to a fund only through payment allocations and fee_items.fund_id. The account is the one named on the receipt, never a guess from the payment method.';

create or replace function public.get_financial_accounts_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_accounts jsonb;
  v_unassigned jsonb;
begin
  if not public.has_finance_capability('FINANCE_ACCOUNTS_VIEW') then
    raise exception 'You are not authorized to view account balances.';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sort_order, x.name), '[]'::jsonb)
  into v_accounts
  from (
    select
      a.id,
      a.code,
      a.name,
      a.account_type::text as account_type,
      a.description,
      a.masked_reference,
      a.opening_balance,
      a.opening_balance_date,
      a.default_for_method::text as default_for_method,
      a.is_active,
      a.sort_order,
      public.finance_account_balance(a.id, null) as current_balance,
      (
        select coalesce(sum(e.account_delta), 0)
        from public.finance_ledger_entries e
        where e.account_id = a.id
          and e.school_id = v_school_id
          and (
            a.opening_balance_date is null
            or e.entry_date > a.opening_balance_date
          )
      ) as ledger_movement,
      (
        select coalesce(sum(p.amount), 0)
        from public.payments p
        where p.financial_account_id = a.id
          and p.school_id = v_school_id
          and p.status = 'completed'::public.payment_status
          and (
            a.opening_balance_date is null
            or p.paid_on > a.opening_balance_date
          )
      ) as assigned_receipts
    from public.financial_accounts a
    where a.school_id = v_school_id
  ) x;

  select jsonb_build_object(
    'count', count(*),
    'amount', coalesce(sum(p.amount), 0)
  ) into v_unassigned
  from public.payments p
  where p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status
    and p.financial_account_id is null;

  return jsonb_build_object(
    'accounts', v_accounts,
    'total_held', (
      select coalesce(sum((v->>'current_balance')::numeric), 0)
      from jsonb_array_elements(v_accounts) v
      where (v->>'is_active')::boolean
    ),
    'unassigned_receipts', coalesce(
      v_unassigned,
      jsonb_build_object('count', 0, 'amount', 0)
    )
  );
end;
$$;

-- Fund positions keep using allocations for student income. Salary lines are
-- omitted from the totals of anyone who cannot see individual salaries.
create or replace function public.get_finance_fund_positions(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_funds jsonb;
  v_can_see_salary boolean := public.has_finance_capability('FINANCE_SALARY_VIEW');
begin
  if not public.has_finance_capability('FINANCE_FUNDS_VIEW') then
    raise exception 'You are not authorized to view fund positions.';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sort_order, x.name), '[]'::jsonb)
  into v_funds
  from (
    select
      f.id,
      f.code,
      f.name,
      f.description,
      f.is_school_fees,
      f.is_active,
      f.sort_order,
      coalesce(sfi.student_income, 0) as student_income,
      coalesce(led.ledger_income, 0) as other_income,
      (coalesce(sfi.student_income, 0) + coalesce(led.ledger_income, 0))
        as total_income,
      coalesce(led.ledger_expense, 0) as total_expenditure,
      (coalesce(sfi.student_income, 0) + coalesce(led.ledger_income, 0)
        - coalesce(led.ledger_expense, 0)) as net_position,
      (not v_can_see_salary and coalesce(led.salary_expense, 0) <> 0)
        as salary_costs_omitted,
      public.finance_allocations_are_active(v_school_id) as allocations_active
    from public.finance_funds f
    left join lateral (
      select sum(v.amount) as student_income
      from public.finance_student_fund_income v
      where v.fund_id = f.id
        and v.school_id = v_school_id
        and (p_from is null or v.entry_date >= p_from)
        and (p_to is null or v.entry_date <= p_to)
    ) sfi on true
    left join lateral (
      select
        sum(e.income_effect) as ledger_income,
        sum(e.expense_effect) filter (
          where v_can_see_salary
            or e.source_type is distinct from 'salary'::public.finance_source_type
        ) as ledger_expense,
        sum(e.expense_effect) filter (
          where e.source_type = 'salary'::public.finance_source_type
        ) as salary_expense
      from public.finance_ledger_entries e
      where e.fund_id = f.id
        and e.school_id = v_school_id
        and (p_from is null or e.entry_date >= p_from)
        and (p_to is null or e.entry_date <= p_to)
    ) led on true
    where f.school_id = v_school_id
  ) x;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'funds', v_funds,
    'allocations_active', public.finance_allocations_are_active(v_school_id),
    'salary_details_visible', v_can_see_salary,
    'total_income', (
      select coalesce(sum((v->>'total_income')::numeric), 0)
      from jsonb_array_elements(v_funds) v
    ),
    'total_expenditure', (
      select coalesce(sum((v->>'total_expenditure')::numeric), 0)
      from jsonb_array_elements(v_funds) v
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- New schools get the same defaults the migration seeds for existing ones.
-- ---------------------------------------------------------------------------

create or replace function public.finance_seed_school_defaults(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_general uuid;
  v_uniforms uuid;
  v_tuck uuid;
  v_meals uuid;
begin
  insert into public.finance_funds
    (school_id, code, name, description, is_school_fees, is_system, sort_order)
  values
    (p_school_id, 'SCHOOL_FEES', 'School Fees',
     'Mandatory tuition and other compulsory school charges.', true, true, 10),
    (p_school_id, 'UNIFORMS', 'Uniforms',
     'Uniform sales income and uniform-related costs.', false, true, 20),
    (p_school_id, 'MEALS', 'Meals',
     'Meal collections and meal-related costs.', false, true, 30),
    (p_school_id, 'TUCK_SHOP', 'Tuck Shop',
     'Tuck shop sales, stock purchases, and running costs.', false, true, 40),
    (p_school_id, 'OTHER', 'Other Income',
     'Donations, hire income, and other school income.', false, true, 50),
    (p_school_id, 'LEGACY_ADDITIONAL', 'Legacy Additional',
     'Historical optional charges that predate fund tracking and cannot be reclassified safely.',
     false, true, 90),
    (p_school_id, 'GENERAL', 'General School Running Costs',
     'Expenditure that is not attributable to a single income activity.',
     false, true, 60)
  on conflict (school_id, code) do nothing;

  insert into public.financial_accounts
    (school_id, code, name, account_type, description, default_for_method, sort_order)
  values
    (p_school_id, 'BANK', 'Bank Account', 'bank'::public.financial_account_type,
     'The school bank account.', 'bank_transfer'::public.payment_method, 10),
    (p_school_id, 'MOBILE_MONEY', 'Mobile Money', 'mobile_money'::public.financial_account_type,
     'School mobile money wallet.', 'mobile_money'::public.payment_method, 20),
    (p_school_id, 'PETTY_CASH', 'Petty Cash', 'petty_cash'::public.financial_account_type,
     'Cash float held at the school for small purchases.', null, 30)
  on conflict (school_id, code) do nothing;

  select id into v_general from public.finance_funds
    where school_id = p_school_id and code = 'GENERAL';
  select id into v_uniforms from public.finance_funds
    where school_id = p_school_id and code = 'UNIFORMS';
  select id into v_tuck from public.finance_funds
    where school_id = p_school_id and code = 'TUCK_SHOP';
  select id into v_meals from public.finance_funds
    where school_id = p_school_id and code = 'MEALS';

  insert into public.expense_categories
    (school_id, code, name, default_fund_id, is_salary, is_system, sort_order)
  values
    (p_school_id, 'SALARIES', 'Salaries', v_general, true, true, 10),
    (p_school_id, 'UTILITIES', 'Utilities (water, electricity)', v_general, false, true, 20),
    (p_school_id, 'TEACHING_MATERIALS', 'Teaching Materials', v_general, false, true, 30),
    (p_school_id, 'MAINTENANCE', 'Maintenance and Repairs', v_general, false, true, 40),
    (p_school_id, 'TRANSPORT', 'Transport', v_general, false, true, 50),
    (p_school_id, 'FOOD_CATERING', 'Food and Catering', v_meals, false, true, 60),
    (p_school_id, 'OFFICE_SUPPLIES', 'Office Supplies', v_general, false, true, 70),
    (p_school_id, 'CLEANING', 'Cleaning and Sanitation', v_general, false, true, 80),
    (p_school_id, 'INTERNET_AIRTIME', 'Internet and Airtime', v_general, false, true, 90),
    (p_school_id, 'BANK_CHARGES', 'Bank Charges', v_general, false, true, 100),
    (p_school_id, 'UNIFORM_PURCHASES', 'Uniform Purchases', v_uniforms, false, true, 110),
    (p_school_id, 'TUCK_SHOP_STOCK', 'Tuck Shop Stock', v_tuck, false, true, 120),
    (p_school_id, 'OTHER_EXPENSE', 'Other', v_general, false, true, 900)
  on conflict (school_id, code) do nothing;
end;
$$;

revoke all on function public.finance_seed_school_defaults(uuid)
  from public, anon, authenticated;

create or replace function public.finance_provision_school_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.finance_seed_school_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists schools_finance_defaults on public.schools;
create trigger schools_finance_defaults
  after insert on public.schools
  for each row execute function public.finance_provision_school_defaults();

do $$
declare
  v_school record;
begin
  for v_school in select id from public.schools loop
    perform public.finance_seed_school_defaults(v_school.id);
  end loop;
end
$$;
