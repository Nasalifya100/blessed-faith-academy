-- ===========================================================================
-- First verified physical starting balance for every active account together.
--
-- Does not set any opening balance and does not correct any receipt date.
--
-- opening_balance_date is the external statement or cash-count day.
-- opening_initialized_at is when that count was captured. The balance formula
-- does not use the timestamp. Membership does.
--
-- After capture, current physical balance =
--   opening balance
--   + every ledger row that is not a member
--   + every completed receipt that is not a member
--
-- Business dates remain reporting attributes. A movement recorded after
-- capture still moves cash when its date is on or before the count day.
-- A movement that already existed is a member and is not added again, whatever
-- its stored date later becomes.
--
-- void_payment reverses the student receipt and its allocations. It does not
-- post a ledger outflow. A voided member therefore stays inside the counted
-- cash. A voided non-member drops out of the completed-receipt sum, which is
-- the existing meaning of void for a receipt that was itself the cash-in.
-- ===========================================================================

alter table public.financial_accounts
  add column if not exists opening_initialized_at timestamptz;

comment on column public.financial_accounts.opening_initialized_at is
  'When the counted opening membership was captured. Null until then. Distinct from opening_balance_date, which is the external end-of-day count.';

create table if not exists public.financial_account_opening_inclusions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  ledger_entry_id uuid references public.finance_ledger_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint financial_account_opening_inclusions_one_movement check (
    (payment_id is not null and ledger_entry_id is null)
    or (payment_id is null and ledger_entry_id is not null)
  )
);

create unique index if not exists financial_account_opening_inclusions_payment_uidx
  on public.financial_account_opening_inclusions (payment_id)
  where payment_id is not null;

create unique index if not exists financial_account_opening_inclusions_ledger_uidx
  on public.financial_account_opening_inclusions (ledger_entry_id)
  where ledger_entry_id is not null;

create index if not exists financial_account_opening_inclusions_account_idx
  on public.financial_account_opening_inclusions (account_id);

comment on table public.financial_account_opening_inclusions is
  'Movements already inside a counted opening balance. Stores ids only. Amounts stay on the payment or ledger row. Delete is restricted so membership cannot disappear and change the derived balance.';

alter table public.financial_account_opening_inclusions enable row level security;

revoke all on table public.financial_account_opening_inclusions
  from public, anon, authenticated, service_role;

create or replace function public.financial_account_opening_inclusions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_account uuid;
begin
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    raise exception 'Counted opening movements cannot be changed or removed.';
  end if;

  if new.payment_id is not null then
    select p.school_id, p.financial_account_id
      into v_school, v_account
    from public.payments p
    where p.id = new.payment_id;
    if v_school is null then
      raise exception 'The counted receipt was not found.';
    end if;
    if v_school is distinct from new.school_id
       or v_account is distinct from new.account_id then
      raise exception 'A receipt can be counted for its own account only.';
    end if;
  else
    select e.school_id, e.account_id
      into v_school, v_account
    from public.finance_ledger_entries e
    where e.id = new.ledger_entry_id;
    if v_school is null then
      raise exception 'The counted ledger movement was not found.';
    end if;
    if v_school is distinct from new.school_id
       or v_account is distinct from new.account_id then
      raise exception 'A ledger movement can be counted for its own account only.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists financial_account_opening_inclusions_guard
  on public.financial_account_opening_inclusions;
create trigger financial_account_opening_inclusions_guard
  before insert or update or delete
  on public.financial_account_opening_inclusions
  for each row
  execute function public.financial_account_opening_inclusions_guard();

-- ---------------------------------------------------------------------------
-- Ordinary edits stay frozen. The batch initializer is the only escape, and
-- it may set the opening amount, date, and capture time once, together.
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

  if current_setting('app.allow_financial_account_initialization', true) = 'on' then
    if old.opening_balance_date is not null or old.opening_initialized_at is not null then
      raise exception 'This account already has a starting balance.';
    end if;
    if new.opening_balance_date is null or new.opening_initialized_at is null then
      raise exception 'A starting balance needs the date it was true.';
    end if;
    if new.school_id is distinct from old.school_id
       or new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.masked_reference is distinct from old.masked_reference
       or new.currency is distinct from old.currency
       or new.default_for_method is distinct from old.default_for_method
       or new.is_active is distinct from old.is_active
       or new.sort_order is distinct from old.sort_order
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by
    then
      raise exception 'Invalid opening balance initialization.';
    end if;
  else
    if new.opening_initialized_at is distinct from old.opening_initialized_at then
      raise exception 'The opening balance cannot change once this account has transactions. Record an adjustment instead.';
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

comment on function public.financial_account_identity_guard() is
  'Account code and type stay fixed. Opening amount, date, and capture time freeze once activity exists, except the transaction-local initialization escape.';

-- Lock named accounts in UUID order so opposite transfers cannot deadlock.
create or replace function public.finance_lock_financial_accounts(p_account_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in
    select distinct u.id
    from unnest(coalesce(p_account_ids, array[]::uuid[])) as u(id)
    where u.id is not null
    order by u.id
  loop
    perform 1
    from public.financial_accounts a
    where a.id = v_id
    for update;
  end loop;
end;
$$;

revoke all on function public.finance_lock_financial_accounts(uuid[])
  from public, anon, authenticated, service_role;

-- A business date on or before the count day is allowed. The row is not a
-- member, so it must still be recordable. The account lock closes the window
-- between membership capture and the opening write.
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
  where a.id = new.account_id and a.school_id = new.school_id
  for update;
  if v_opening is null and not exists (
    select 1 from public.financial_accounts a
    where a.id = new.account_id and a.school_id = new.school_id
  ) then
    raise exception 'The selected account belongs to a different school.';
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
  where a.id = new.financial_account_id
  for update;

  if v_account.id is null or v_account.school_id <> new.school_id then
    raise exception 'The selected account does not belong to this school.';
  end if;
  if not v_account.is_active then
    raise exception 'The selected account is not active.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Physical balance. Membership, not the business date, decides whether an
-- existing movement is already inside the opening amount.
-- p_as_of is a reporting filter on paid_on / entry_date. It is not membership.
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
      v_account.opening_initialized_at is null
      or not exists (
        select 1 from public.financial_account_opening_inclusions i
        where i.account_id = v_account.id
          and i.ledger_entry_id = e.id
      )
    );

  select coalesce(sum(p.amount), 0) into v_student
  from public.payments p
  where p.school_id = v_school_id
    and p.financial_account_id = v_account.id
    and p.status = 'completed'::public.payment_status
    and (p_as_of is null or p.paid_on <= p_as_of)
    and (
      v_account.opening_initialized_at is null
      or not exists (
        select 1 from public.financial_account_opening_inclusions i
        where i.account_id = v_account.id
          and i.payment_id = p.id
      )
    );

  return (v_account.opening_balance + v_ledger + v_student)::numeric(12, 2);
end;
$$;

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
      a.opening_initialized_at,
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
            a.opening_initialized_at is null
            or not exists (
              select 1 from public.financial_account_opening_inclusions i
              where i.account_id = a.id
                and i.ledger_entry_id = e.id
            )
          )
      ) as ledger_movement,
      (
        select coalesce(sum(p.amount), 0)
        from public.payments p
        where p.financial_account_id = a.id
          and p.school_id = v_school_id
          and p.status = 'completed'::public.payment_status
          and (
            a.opening_initialized_at is null
            or not exists (
              select 1 from public.financial_account_opening_inclusions i
              where i.account_id = a.id
                and i.payment_id = p.id
            )
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
      'payment_date_corrected',
      'financial_account_opening_balance_initialized'
    )
  );

-- Transfers lock both accounts in UUID order before either ledger leg is posted.
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

  perform pg_advisory_xact_lock(hashtext(v_school_id::text || ':transfer'));
  perform public.finance_lock_financial_accounts(array[p_from_account_id, p_to_account_id]);

  insert into public.finance_transfers (
    school_id, transfer_date, amount, from_account_id, to_account_id,
    description, reference, recorded_by
  ) values (
    v_school_id, v_date, v_amount, p_from_account_id, p_to_account_id,
    v_description, nullif(btrim(coalesce(p_reference, '')), ''), auth.uid()
  ) returning id into v_transfer_id;

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

  perform pg_advisory_xact_lock(hashtext(v_school_id::text || ':transfer'));
  perform public.finance_lock_financial_accounts(
    array[v_transfer.from_account_id, v_transfer.to_account_id]
  );

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

create or replace function public.initialize_school_opening_balances(
  p_school_id uuid,
  p_opening_balance_date date,
  p_balances jsonb,
  p_reason text,
  p_source_reference text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_source text := btrim(coalesce(p_source_reference, ''));
  v_rejection text;
  v_actor uuid := auth.uid();
  v_batch uuid := gen_random_uuid();
  v_captured timestamptz := clock_timestamp();
  v_ids uuid[];
  v_account public.financial_accounts%rowtype;
  v_item jsonb;
  v_account_id uuid;
  v_opening numeric(12, 2);
  v_payment_count int := 0;
  v_ledger_count int := 0;
  v_count int := 0;
  v_updated uuid;
begin
  if p_school_id is null then
    raise exception 'A school is required.';
  end if;
  if jsonb_typeof(p_balances) is distinct from 'array' or jsonb_array_length(p_balances) = 0 then
    raise exception 'Every active account needs the amount actually held.';
  end if;
  if length(v_reason) < 3 then
    raise exception 'A reason for the starting balance is required.';
  end if;
  if length(v_source) < 3 then
    raise exception 'A source reference for the starting balance is required.';
  end if;

  v_rejection := public.payment_paid_on_rejection(p_opening_balance_date);
  if v_rejection is not null then
    raise exception '%', v_rejection;
  end if;

  if v_actor is not null then
    if public.current_user_school_id() is distinct from p_school_id then
      raise exception 'The account belongs to a different school.';
    end if;
    if not public.has_finance_capability('FINANCE_SETUP_MANAGE') then
      raise exception 'You are not authorized to set a starting balance.';
    end if;
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into v_ids
  from public.financial_accounts a
  where a.school_id = p_school_id
    and a.is_active;

  if cardinality(v_ids) = 0 then
    raise exception 'There is no active account to initialize.';
  end if;

  perform public.finance_lock_financial_accounts(v_ids);

  if exists (
    select 1
    from public.financial_accounts a
    where a.id = any (v_ids)
      and a.opening_balance_date is not null
  ) then
    raise exception 'This school already has a starting balance.';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_balances)
  ) is distinct from (
    select count(distinct item->>'account_id')
    from jsonb_array_elements(p_balances) item
  ) then
    raise exception 'Each account can be initialized only once.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_balances) item
    where (item->>'account_id')::uuid <> all (v_ids)
       or not exists (
         select 1 from public.financial_accounts a
         where a.id = (item->>'account_id')::uuid
           and a.school_id = p_school_id
           and a.is_active
       )
  ) then
    raise exception 'Every active account must be included in the same starting balance.';
  end if;

  if (
    select count(*) from unnest(v_ids)
  ) is distinct from (
    select count(distinct item->>'account_id')
    from jsonb_array_elements(p_balances) item
  ) then
    raise exception 'Every active account must be included in the same starting balance.';
  end if;

  for v_item in
    select item
    from jsonb_array_elements(p_balances) item
    order by (item->>'account_id')::uuid
  loop
    v_account_id := (v_item->>'account_id')::uuid;
    v_opening := round(coalesce((v_item->>'opening_balance')::numeric, 0), 2);
    if v_opening < 0 then
      raise exception 'An opening balance cannot be negative.';
    end if;

    select * into v_account
    from public.financial_accounts a
    where a.id = v_account_id
      and a.school_id = p_school_id;

    if not v_account.is_active then
      raise exception 'Only an active account can receive a starting balance.';
    end if;

    insert into public.financial_account_opening_inclusions (
      school_id, account_id, payment_id
    )
    select v_account.school_id, v_account.id, p.id
    from public.payments p
    where p.financial_account_id = v_account.id
      and p.school_id = v_account.school_id
      and p.status = 'completed'::public.payment_status;
    get diagnostics v_payment_count = row_count;

    insert into public.financial_account_opening_inclusions (
      school_id, account_id, ledger_entry_id
    )
    select v_account.school_id, v_account.id, e.id
    from public.finance_ledger_entries e
    where e.account_id = v_account.id
      and e.school_id = v_account.school_id;
    get diagnostics v_ledger_count = row_count;
    v_count := v_payment_count + v_ledger_count;

    perform set_config('app.allow_financial_account_initialization', 'on', true);

    update public.financial_accounts
    set opening_balance = v_opening,
        opening_balance_date = p_opening_balance_date,
        opening_initialized_at = v_captured,
        updated_by = v_actor
    where id = v_account.id
      and opening_balance_date is null
      and opening_initialized_at is null
    returning id into v_updated;

    perform set_config('app.allow_financial_account_initialization', '', true);

    if v_updated is null then
      raise exception 'The starting balance was not recorded.';
    end if;

    perform public.log_finance_event(
      v_account.school_id,
      null,
      'financial_account_opening_balance_initialized',
      null,
      null,
      null,
      v_opening,
      v_actor,
      v_reason,
      jsonb_build_object(
        'batch_id', v_batch,
        'account_id', v_account.id,
        'account_code', v_account.code,
        'opening_balance', v_opening,
        'opening_balance_date', p_opening_balance_date,
        'opening_initialized_at', v_captured,
        'source_reference', v_source,
        'included_movements', v_count,
        'actor_context', case
          when v_actor is null then 'database_operator'
          else 'signed_in_session'
        end
      )
    );
  end loop;

  return v_batch;
exception
  when others then
    perform set_config('app.allow_financial_account_initialization', '', true);
    raise;
end;
$$;

comment on function public.initialize_school_opening_balances(uuid, date, jsonb, text, text) is
  'One transaction for every active account. Database-owner only. Snapshots existing movement ids, writes no ledger, income, expense, or transfer, and does not correct receipt dates.';

revoke all on function public.initialize_school_opening_balances(uuid, date, jsonb, text, text)
  from public, anon, authenticated, service_role;

-- paid_on is the reporting date. Membership decides physical cash, so a date
-- correction no longer changes Money Held and may cross the count day.
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
  v_included boolean := false;
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

  v_included := exists (
    select 1
    from public.financial_account_opening_inclusions i
    where i.payment_id = v_payment.id
  );

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
      'status_unchanged', v_payment.status,
      'opening_inclusion', v_included
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
  'Corrects one completed paid_on for reporting. Physical Money Held follows opening membership, not the stored date.';

revoke all on function public.correct_payment_paid_on(uuid, date, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.financial_account_opening_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_rows jsonb;
begin
  if auth.uid() is not null then
    if not public.has_finance_capability('FINANCE_ACCOUNTS_VIEW') then
      raise exception 'You are not authorized to view account balances.';
    end if;
    v_school_id := public.current_user_school_id();
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.code), '[]'::jsonb)
  into v_rows
  from (
    select
      a.code,
      a.name,
      a.is_active as active,
      a.opening_balance,
      a.opening_balance_date,
      a.opening_initialized_at,
      case
        when a.opening_initialized_at is not null then 'initialized'
        when exists (
          select 1
          from public.financial_accounts other
          where other.school_id = a.school_id
            and other.is_active
            and other.opening_initialized_at is not null
        ) then 'blocked'
        when exists (
          select 1 from public.payments p
          where p.financial_account_id = a.id
            and p.status = 'completed'::public.payment_status
        ) or exists (
          select 1 from public.finance_ledger_entries e
          where e.account_id = a.id
        ) then 'ready'
        else 'not_initialized'
      end as initialization_status,
      (
        select count(*)
        from public.payments p
        where p.financial_account_id = a.id
          and p.status = 'completed'::public.payment_status
      ) as attributed_completed_receipt_count,
      (
        select coalesce(sum(p.amount), 0)
        from public.payments p
        where p.financial_account_id = a.id
          and p.status = 'completed'::public.payment_status
      ) as attributed_receipt_amount,
      (
        select count(*)
        from public.finance_ledger_entries e
        where e.account_id = a.id
      ) as ledger_movement_count,
      (
        select count(*)
        from public.payments p
        where p.financial_account_id = a.id
          and p.status = 'completed'::public.payment_status
          and public.payment_paid_on_rejection(p.paid_on) is not null
      ) as suspicious_receipt_count,
      (
        select min(d)
        from (
          select p.paid_on as d
          from public.payments p
          where p.financial_account_id = a.id
            and p.status = 'completed'::public.payment_status
          union all
          select e.entry_date
          from public.finance_ledger_entries e
          where e.account_id = a.id
        ) dates
      ) as earliest_relevant_date,
      (
        select max(d)
        from (
          select p.paid_on as d
          from public.payments p
          where p.financial_account_id = a.id
            and p.status = 'completed'::public.payment_status
          union all
          select e.entry_date
          from public.finance_ledger_entries e
          where e.account_id = a.id
        ) dates
      ) as latest_relevant_date,
      (
        select count(*)
        from public.financial_account_opening_inclusions i
        where i.account_id = a.id
      ) as included_movement_count
    from public.financial_accounts a
    where v_school_id is null or a.school_id = v_school_id
  ) x;

  return v_rows;
end;
$$;

comment on function public.financial_account_opening_readiness() is
  'Read-only account cutover inventory. No pupil names. Does not write. Suspicious dates are reported and do not block initialization.';

revoke all on function public.financial_account_opening_readiness()
  from public, anon, service_role;
grant execute on function public.financial_account_opening_readiness()
  to authenticated;
