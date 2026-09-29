-- ===========================================================================
-- Finance upgrade — Stage 1: funds, physical accounts, and capabilities
--
-- Additive only. No existing table, function, policy, or row is modified
-- except:
--   * fee_items gains a nullable fund_id (backfilled deterministically)
--   * finance_event_audits event_type check gains the new finance events
--
-- Two orthogonal concepts are introduced and must never be conflated:
--   finance_funds       -> what the money belongs to / came from
--   financial_accounts  -> where the money is physically held
--
-- Money stays numeric(12,2) ZMW, consistent with charges/payments.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'financial_account_type') then
    create type public.financial_account_type as enum (
      'bank',
      'mobile_money',
      'petty_cash'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- finance_funds — internal activities (School Fees, Uniforms, Meals, ...)
-- ---------------------------------------------------------------------------

create table if not exists public.finance_funds (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  -- Mandatory tuition/fee obligations. Exactly one fund per school may carry
  -- this flag; it is what the School Fees balance is derived from.
  is_school_fees boolean not null default false,
  -- System funds cannot be renamed away or deleted; they anchor reporting.
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint finance_funds_code_format
    check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 40),
  constraint finance_funds_name_present
    check (length(btrim(name)) > 0)
);

create unique index if not exists finance_funds_school_code_uidx
  on public.finance_funds (school_id, code);

-- At most one School Fees fund per school.
create unique index if not exists finance_funds_one_school_fees_uidx
  on public.finance_funds (school_id)
  where is_school_fees;

create index if not exists finance_funds_school_active_idx
  on public.finance_funds (school_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- financial_accounts — physical money locations (Bank, Mobile Money, Petty Cash)
-- ---------------------------------------------------------------------------

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  code text not null,
  name text not null,
  account_type public.financial_account_type not null,
  description text,
  -- Masked tail only (e.g. "****4321"). Full account numbers are never stored.
  masked_reference text,
  opening_balance numeric(12, 2) not null default 0,
  opening_balance_date date,
  currency text not null default 'ZMW',
  -- When a student payment arrives by this method, it lands in this account.
  -- At most one account per school may claim a given method.
  default_for_method public.payment_method,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint financial_accounts_code_format
    check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 40),
  constraint financial_accounts_name_present
    check (length(btrim(name)) > 0),
  constraint financial_accounts_currency_zmw
    check (currency = 'ZMW'),
  -- Guards against a full account number being pasted into the masked field.
  constraint financial_accounts_masked_reference_short
    check (masked_reference is null or length(btrim(masked_reference)) <= 12)
);

create unique index if not exists financial_accounts_school_code_uidx
  on public.financial_accounts (school_id, code);

create unique index if not exists financial_accounts_default_method_uidx
  on public.financial_accounts (school_id, default_for_method)
  where default_for_method is not null;

create index if not exists financial_accounts_school_active_idx
  on public.financial_accounts (school_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuses the existing set_updated_at helper)
-- ---------------------------------------------------------------------------

drop trigger if exists finance_funds_set_updated_at on public.finance_funds;
create trigger finance_funds_set_updated_at
  before update on public.finance_funds
  for each row execute function public.set_updated_at();

drop trigger if exists financial_accounts_set_updated_at on public.financial_accounts;
create trigger financial_accounts_set_updated_at
  before update on public.financial_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Fund identity is permanent so historical attribution survives deactivation.
-- The matching account guard lives in the ledger migration, where it can also
-- protect the opening balance once transactions exist (FIN-18 / FIN-19).
-- ---------------------------------------------------------------------------

create or replace function public.finance_fund_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_system then
    if new.code is distinct from old.code then
      raise exception 'The % fund code cannot be changed.', old.code;
    end if;
    if new.is_school_fees is distinct from old.is_school_fees then
      raise exception 'The School Fees designation cannot be moved.';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.finance_fund_identity_guard() is
  'Keeps system fund codes stable so historical transactions stay attributable.';

drop trigger if exists finance_funds_identity_guard on public.finance_funds;
create trigger finance_funds_identity_guard
  before update on public.finance_funds
  for each row execute function public.finance_fund_identity_guard();

-- ---------------------------------------------------------------------------
-- has_finance_capability — mirrors the proven has_academic_capability pattern.
-- Reads the same profiles.role; this is NOT a second role system.
-- ---------------------------------------------------------------------------

create or replace function public.has_finance_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.staff_role;
  v_cap text := upper(btrim(coalesce(p_capability, '')));
begin
  if auth.uid() is null then
    return false;
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active;

  if not found then
    return false;
  end if;

  -- Administrator retains full finance authority.
  if v_role = 'administrator'::public.staff_role then
    return true;
  end if;

  -- Headteacher: oversight and approval, plus salary visibility.
  if v_role = 'headteacher'::public.staff_role then
    return v_cap in (
      'FINANCE_VIEW',
      'FINANCE_FUNDS_VIEW',
      'FINANCE_ACCOUNTS_VIEW',
      'FINANCE_REPORTS_VIEW',
      'FINANCE_LEDGER_RECORD',
      'FINANCE_EXPENSE_RECORD',
      'FINANCE_EXPENSE_APPROVE',
      'FINANCE_EXPENSE_PAY',
      'FINANCE_TRANSFER_RECORD',
      'FINANCE_REVERSE',
      'FINANCE_PETTY_CASH_RECORD',
      'FINANCE_SALARY_VIEW',
      'FINANCE_SALARY_RECORD',
      'FINANCE_SALARY_APPROVE',
      'FINANCE_SALARY_PAY',
      'FINANCE_SETUP_MANAGE'
    );
  end if;

  -- Bursar: day-to-day finance operation. Records and pays, and may see
  -- salary data because the bursar disburses it, but cannot approve
  -- salaries (separation of duties) or reconfigure funds/accounts.
  if v_role = 'bursar'::public.staff_role then
    return v_cap in (
      'FINANCE_VIEW',
      'FINANCE_FUNDS_VIEW',
      'FINANCE_ACCOUNTS_VIEW',
      'FINANCE_REPORTS_VIEW',
      'FINANCE_LEDGER_RECORD',
      'FINANCE_EXPENSE_RECORD',
      'FINANCE_EXPENSE_PAY',
      'FINANCE_TRANSFER_RECORD',
      'FINANCE_REVERSE',
      'FINANCE_PETTY_CASH_RECORD',
      'FINANCE_SALARY_VIEW',
      'FINANCE_SALARY_RECORD',
      'FINANCE_SALARY_PAY'
    );
  end if;

  -- Secretary: operational visibility of non-salary activity only.
  -- No salary capability of any kind, and no authority to move money.
  if v_role = 'secretary'::public.staff_role then
    return v_cap in (
      'FINANCE_VIEW',
      'FINANCE_FUNDS_VIEW'
    );
  end if;

  -- Teacher and any future role: no finance authority.
  return false;
end;
$$;

comment on function public.has_finance_capability(text) is
  'Finance capability gate. Salary capabilities are deliberately withheld from secretary and teacher.';

revoke all on function public.has_finance_capability(text) from public, anon;
grant execute on function public.has_finance_capability(text) to authenticated;

-- ---------------------------------------------------------------------------
-- fee_items -> fund mapping (additive, deterministic backfill)
-- ---------------------------------------------------------------------------

alter table public.fee_items
  add column if not exists fund_id uuid references public.finance_funds(id);

create index if not exists fee_items_fund_idx
  on public.fee_items (school_id, fund_id);

-- ---------------------------------------------------------------------------
-- Seed the system funds and accounts for every existing school, then map
-- the fee catalogue onto them. Deterministic and rerun-safe.
--
-- Mapping rules (no guessing — see docs/FINANCE_DATA_MIGRATION_PLAN.md):
--   category 'tuition'                  -> SCHOOL_FEES
--   category 'meal'                     -> MEALS
--   category 'uniform'                  -> UNIFORMS
--   category 'extra' and not optional   -> SCHOOL_FEES  (mandatory academic charge)
--   category 'extra' and optional       -> LEGACY_ADDITIONAL (cannot be proven)
-- ---------------------------------------------------------------------------

do $$
declare
  v_school record;
begin
  for v_school in select id from public.schools loop
    insert into public.finance_funds
      (school_id, code, name, description, is_school_fees, is_system, sort_order)
    values
      (v_school.id, 'SCHOOL_FEES', 'School Fees',
       'Mandatory tuition and other compulsory school charges.', true, true, 10),
      (v_school.id, 'UNIFORMS', 'Uniforms',
       'Uniform sales income and uniform-related costs.', false, true, 20),
      (v_school.id, 'MEALS', 'Meals',
       'Meal collections and meal-related costs.', false, true, 30),
      (v_school.id, 'TUCK_SHOP', 'Tuck Shop',
       'Tuck shop sales, stock purchases, and running costs.', false, true, 40),
      (v_school.id, 'OTHER', 'Other Income',
       'Donations, hire income, and other school income.', false, true, 50),
      (v_school.id, 'LEGACY_ADDITIONAL', 'Legacy Additional',
       'Historical optional charges that predate fund tracking and cannot be reclassified safely.',
       false, true, 90),
      (v_school.id, 'GENERAL', 'General School Running Costs',
       'Expenditure that is not attributable to a single income activity.',
       false, true, 60)
    on conflict (school_id, code) do nothing;

    insert into public.financial_accounts
      (school_id, code, name, account_type, description, default_for_method, sort_order)
    values
      (v_school.id, 'BANK', 'Bank Account', 'bank'::public.financial_account_type,
       'The school bank account.', 'bank_transfer'::public.payment_method, 10),
      (v_school.id, 'MOBILE_MONEY', 'Mobile Money', 'mobile_money'::public.financial_account_type,
       'School mobile money wallet.', 'mobile_money'::public.payment_method, 20),
      (v_school.id, 'PETTY_CASH', 'Petty Cash', 'petty_cash'::public.financial_account_type,
       'Cash float held at the school for small purchases.', null, 30)
    on conflict (school_id, code) do nothing;
  end loop;
end
$$;

-- Deterministic fee-item mapping. Only fills NULLs, so it is rerun-safe and
-- never overrides an administrator's later reclassification.
update public.fee_items fi
set fund_id = f.id
from public.finance_funds f
where fi.fund_id is null
  and f.school_id = fi.school_id
  and f.code = case
    when fi.category = 'tuition'::public.fee_category then 'SCHOOL_FEES'
    when fi.category = 'meal'::public.fee_category then 'MEALS'
    when fi.category = 'uniform'::public.fee_category then 'UNIFORMS'
    when fi.category = 'extra'::public.fee_category and not fi.is_optional then 'SCHOOL_FEES'
    else 'LEGACY_ADDITIONAL'
  end;

-- New fee items must declare a fund once the catalogue is mapped.
create or replace function public.fee_items_default_fund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fund_id is null then
    select f.id into new.fund_id
    from public.finance_funds f
    where f.school_id = new.school_id
      and f.code = case
        when new.category = 'tuition'::public.fee_category then 'SCHOOL_FEES'
        when new.category = 'meal'::public.fee_category then 'MEALS'
        when new.category = 'uniform'::public.fee_category then 'UNIFORMS'
        when new.category = 'extra'::public.fee_category and not new.is_optional then 'SCHOOL_FEES'
        else 'LEGACY_ADDITIONAL'
      end;
  end if;

  if new.fund_id is not null and not exists (
    select 1 from public.finance_funds f
    where f.id = new.fund_id and f.school_id = new.school_id
  ) then
    raise exception 'The selected fund belongs to a different school.';
  end if;

  return new;
end;
$$;

drop trigger if exists fee_items_default_fund on public.fee_items;
create trigger fee_items_default_fund
  before insert or update on public.fee_items
  for each row execute function public.fee_items_default_fund();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.finance_funds enable row level security;
alter table public.financial_accounts enable row level security;

drop policy if exists finance_funds_select on public.finance_funds;
create policy finance_funds_select on public.finance_funds
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_FUNDS_VIEW')
  );

drop policy if exists financial_accounts_select on public.financial_accounts;
create policy financial_accounts_select on public.financial_accounts
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_ACCOUNTS_VIEW')
  );

-- Setup is performed through RPCs so school scoping and capability checks
-- cannot be bypassed by a crafted client insert.
revoke insert, update, delete on public.finance_funds from authenticated, anon, public;
revoke insert, update, delete on public.financial_accounts from authenticated, anon, public;
grant select on public.finance_funds to authenticated;
grant select on public.financial_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Extend the finance audit event vocabulary for the new flows.
-- ---------------------------------------------------------------------------

alter table public.finance_event_audits
  drop constraint if exists finance_event_audits_event_type_check;

alter table public.finance_event_audits
  add constraint finance_event_audits_event_type_check check (
    event_type in (
      -- existing
      'payment_recorded',
      'allocation_created',
      'advance_credit_created',
      'credit_applied',
      'payment_voided',
      'allocations_reversed',
      'historical_backfill',
      'optional_charge_cancelled',
      -- finance upgrade
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
      'account_updated'
    )
  );
