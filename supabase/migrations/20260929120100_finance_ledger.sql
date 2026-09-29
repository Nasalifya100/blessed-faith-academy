-- ===========================================================================
-- Finance upgrade — Stage 2: the general ledger
--
-- SCOPE BOUNDARY (important, and deliberate):
--   Student fee/uniform/meal payments remain owned by public.payments and
--   public.payment_allocations. They are NOT copied into this ledger, because
--   duplicating them would create a second source of truth for money the
--   school has already proven it can account for.
--
--   This ledger owns everything payments cannot express:
--     * expenditure of every kind
--     * salaries
--     * account-to-account transfers
--     * non-student income (tuck shop takings, uniform sales to the public,
--       donations, hire income)
--     * corrective adjustments
--
--   Reporting unions the two (see the reporting migration). Each kwacha is
--   recorded exactly once, in exactly one authoritative place.
--
-- Money stays numeric(12,2) ZMW. Signed effects are GENERATED columns so the
-- "transfers are not income and not expenditure" rule cannot be broken by a
-- caller, a query, or a future developer.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'finance_entry_type') then
    create type public.finance_entry_type as enum (
      'income',
      'expense',
      'transfer_in',
      'transfer_out',
      'adjustment'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_direction') then
    create type public.finance_direction as enum ('in', 'out');
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_source_type') then
    create type public.finance_source_type as enum (
      'manual',
      'expense',
      'salary',
      'transfer',
      'adjustment'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- finance_ledger_entries
-- ---------------------------------------------------------------------------

create table if not exists public.finance_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,

  entry_date date not null,
  entry_type public.finance_entry_type not null,
  direction public.finance_direction not null,
  amount numeric(12, 2) not null,
  currency text not null default 'ZMW',

  -- What the money belongs to. Required for income/expense, forbidden for
  -- transfers: moving money between the school's own accounts does not
  -- belong to any activity.
  fund_id uuid references public.finance_funds(id),
  -- Where the money physically moved. Always required.
  account_id uuid not null references public.financial_accounts(id),

  description text not null,
  reference text,
  payee text,

  source_type public.finance_source_type not null default 'manual',
  -- Polymorphic by design: the owning expense/salary/transfer row. Not a FK,
  -- because those tables reference this one. Integrity is enforced by the
  -- RPCs that write both sides in one transaction.
  source_id uuid,

  student_id uuid references public.students(id) on delete set null,
  staff_id uuid references public.profiles(id) on delete set null,

  recorded_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz not null default now(),

  -- Reversal relationship. The unique index on reverses_entry_id is what
  -- makes double reversal impossible (FIN-05).
  is_reversal boolean not null default false,
  reverses_entry_id uuid references public.finance_ledger_entries(id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null,
  reversal_reason text,

  created_at timestamptz not null default now(),

  -- Signed effects. Computed by the database so no report can get them wrong.
  account_delta numeric(12, 2) generated always as (
    case when direction = 'in'::public.finance_direction then amount else -amount end
  ) stored,

  -- Only 'income' entries move the income total. Transfers contribute zero
  -- by construction (FIN-07).
  income_effect numeric(12, 2) generated always as (
    case
      when entry_type = 'income'::public.finance_entry_type
        then case when direction = 'in'::public.finance_direction then amount else -amount end
      else 0
    end
  ) stored,

  -- Only 'expense' entries move the expenditure total. Transfers contribute
  -- zero by construction (FIN-08).
  expense_effect numeric(12, 2) generated always as (
    case
      when entry_type = 'expense'::public.finance_entry_type
        then case when direction = 'out'::public.finance_direction then amount else -amount end
      else 0
    end
  ) stored,

  constraint finance_ledger_amount_positive check (amount > 0),
  constraint finance_ledger_currency_zmw check (currency = 'ZMW'),
  constraint finance_ledger_description_present
    check (length(btrim(description)) > 0),

  -- Direction is fully determined by type, flipping for reversals.
  constraint finance_ledger_direction_matches_type check (
    case entry_type
      when 'income'::public.finance_entry_type then
        direction = (case when is_reversal then 'out' else 'in' end)::public.finance_direction
      when 'expense'::public.finance_entry_type then
        direction = (case when is_reversal then 'in' else 'out' end)::public.finance_direction
      when 'transfer_in'::public.finance_entry_type then
        direction = (case when is_reversal then 'out' else 'in' end)::public.finance_direction
      when 'transfer_out'::public.finance_entry_type then
        direction = (case when is_reversal then 'in' else 'out' end)::public.finance_direction
      else true
    end
  ),

  -- Funds and accounts are never conflated (FIN-11).
  constraint finance_ledger_fund_presence check (
    case
      when entry_type in (
        'income'::public.finance_entry_type,
        'expense'::public.finance_entry_type
      ) then fund_id is not null
      when entry_type in (
        'transfer_in'::public.finance_entry_type,
        'transfer_out'::public.finance_entry_type
      ) then fund_id is null
      else true
    end
  ),

  constraint finance_ledger_reversal_shape check (
    (is_reversal and reverses_entry_id is not null)
    or (not is_reversal and reverses_entry_id is null)
  ),

  constraint finance_ledger_reversed_shape check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (reversed_at is not null and length(btrim(coalesce(reversal_reason, ''))) > 0)
  ),

  -- Transfers always carry their transfer header.
  constraint finance_ledger_transfer_source check (
    case
      when entry_type in (
        'transfer_in'::public.finance_entry_type,
        'transfer_out'::public.finance_entry_type
      ) then source_type = 'transfer'::public.finance_source_type and source_id is not null
      else true
    end
  )
);

create unique index if not exists finance_ledger_one_reversal_uidx
  on public.finance_ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;

create index if not exists finance_ledger_school_date_idx
  on public.finance_ledger_entries (school_id, entry_date desc, created_at desc);

create index if not exists finance_ledger_fund_date_idx
  on public.finance_ledger_entries (school_id, fund_id, entry_date desc);

create index if not exists finance_ledger_account_date_idx
  on public.finance_ledger_entries (school_id, account_id, entry_date desc);

create index if not exists finance_ledger_source_idx
  on public.finance_ledger_entries (source_type, source_id);

create index if not exists finance_ledger_student_idx
  on public.finance_ledger_entries (student_id, entry_date desc)
  where student_id is not null;

comment on table public.finance_ledger_entries is
  'Non-student-payment money movements. Student payments live in public.payments.';
comment on column public.finance_ledger_entries.income_effect is
  'Signed income contribution. Transfers are always 0.';
comment on column public.finance_ledger_entries.expense_effect is
  'Signed expenditure contribution. Transfers are always 0.';

-- ---------------------------------------------------------------------------
-- Cross-school and cross-reference integrity
-- ---------------------------------------------------------------------------

create or replace function public.finance_ledger_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.finance_ledger_entries%rowtype;
begin
  if new.fund_id is not null and not exists (
    select 1 from public.finance_funds f
    where f.id = new.fund_id and f.school_id = new.school_id
  ) then
    raise exception 'The selected fund belongs to a different school.';
  end if;

  if not exists (
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

drop trigger if exists finance_ledger_validate on public.finance_ledger_entries;
create trigger finance_ledger_validate
  before insert on public.finance_ledger_entries
  for each row execute function public.finance_ledger_validate();

-- ---------------------------------------------------------------------------
-- Immutability. A posted transaction is never edited and never deleted; the
-- only permitted change is stamping the reversal marker, and only from inside
-- an approved function that sets app.allow_ledger_reversal (FIN-02, FIN-03).
-- ---------------------------------------------------------------------------

create or replace function public.finance_ledger_enforce_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Financial transactions cannot be deleted. Reverse the transaction instead.';
  end if;

  if coalesce(current_setting('app.allow_ledger_reversal', true), '') <> 'on' then
    raise exception
      'Financial transactions cannot be edited. Reverse the transaction instead.';
  end if;

  -- Even under the reversal flag, only the reversal marker may move.
  if (new.id, new.school_id, new.entry_date, new.entry_type, new.direction,
      new.amount, new.currency, new.fund_id, new.account_id, new.description,
      new.reference, new.payee, new.source_type, new.source_id, new.student_id,
      new.staff_id, new.recorded_by, new.is_reversal, new.reverses_entry_id)
     is distinct from
     (old.id, old.school_id, old.entry_date, old.entry_type, old.direction,
      old.amount, old.currency, old.fund_id, old.account_id, old.description,
      old.reference, old.payee, old.source_type, old.source_id, old.student_id,
      old.staff_id, old.recorded_by, old.is_reversal, old.reverses_entry_id)
  then
    raise exception 'Only the reversal record of a transaction may be updated.';
  end if;

  if old.reversed_at is not null then
    raise exception 'This transaction has already been reversed.';
  end if;

  return new;
end;
$$;

drop trigger if exists finance_ledger_enforce_immutability
  on public.finance_ledger_entries;
create trigger finance_ledger_enforce_immutability
  before update or delete on public.finance_ledger_entries
  for each row execute function public.finance_ledger_enforce_immutability();

-- ---------------------------------------------------------------------------
-- Account guard: codes are permanent, and the opening balance freezes once
-- the account has been used.
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
     and exists (
       select 1 from public.finance_ledger_entries e where e.account_id = old.id
     )
  then
    raise exception
      'The opening balance cannot change once this account has transactions. Record an adjustment instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists financial_accounts_identity_guard on public.financial_accounts;
create trigger financial_accounts_identity_guard
  before update on public.financial_accounts
  for each row execute function public.financial_account_identity_guard();

-- ---------------------------------------------------------------------------
-- RLS — read is capability-gated; every write goes through a DEFINER RPC.
-- ---------------------------------------------------------------------------

alter table public.finance_ledger_entries enable row level security;

drop policy if exists finance_ledger_entries_select on public.finance_ledger_entries;
create policy finance_ledger_entries_select on public.finance_ledger_entries
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_VIEW')
    -- Salary rows are withheld from anyone without salary visibility, so a
    -- generic ledger export can never leak pay (FIN-17).
    and (
      source_type <> 'salary'::public.finance_source_type
      or public.has_finance_capability('FINANCE_SALARY_VIEW')
    )
  );

revoke insert, update, delete on public.finance_ledger_entries
  from authenticated, anon, public;
grant select on public.finance_ledger_entries to authenticated;
