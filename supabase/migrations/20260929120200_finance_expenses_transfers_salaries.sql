-- ===========================================================================
-- Finance upgrade — Stage 3: expenditure, transfers, and salaries
--
-- Lifecycle note: an expense or salary row is a *record of intent* until it
-- is paid. Only payment creates a ledger entry, because only payment moves
-- real money out of a real account.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_status') then
    create type public.expense_status as enum (
      'recorded',
      'approved',
      'paid',
      'reversed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'salary_payment_status') then
    create type public.salary_payment_status as enum (
      'draft',
      'approved',
      'paid',
      'reversed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'disbursement_method') then
    create type public.disbursement_method as enum (
      'cash',
      'mobile_money',
      'bank_transfer',
      'cheque'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- expense_categories — configurable, seeded with the school's real cost lines
-- ---------------------------------------------------------------------------

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  -- Suggested fund, used to pre-select in the UI. The recorder may override.
  default_fund_id uuid references public.finance_funds(id),
  -- Salary categories are only usable by the salary workflow.
  is_salary boolean not null default false,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_code_format
    check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 40),
  constraint expense_categories_name_present check (length(btrim(name)) > 0)
);

create unique index if not exists expense_categories_school_code_uidx
  on public.expense_categories (school_id, code);

create index if not exists expense_categories_school_active_idx
  on public.expense_categories (school_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,

  expense_date date not null,
  amount numeric(12, 2) not null,
  currency text not null default 'ZMW',
  category_id uuid not null references public.expense_categories(id),
  -- Which activity bears the cost (Uniforms, Tuck Shop, General, ...).
  fund_id uuid not null references public.finance_funds(id),
  -- Which physical account the money leaves. Chosen at payment time, but
  -- captured up front so approvers can see the intended source.
  account_id uuid not null references public.financial_accounts(id),

  description text not null,
  payee text,
  payment_method public.disbursement_method,
  reference text,
  notes text,

  -- Supporting document metadata only. No file bytes and no signed URLs are
  -- stored here; attachment storage is a deferred phase.
  document_reference text,
  document_note text,

  status public.expense_status not null default 'recorded',

  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,

  ledger_entry_id uuid references public.finance_ledger_entries(id),

  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null,
  reversal_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expenses_amount_positive check (amount > 0),
  constraint expenses_currency_zmw check (currency = 'ZMW'),
  constraint expenses_description_present check (length(btrim(description)) > 0),
  constraint expenses_approved_shape check (
    (status = 'recorded'::public.expense_status and approved_at is null)
    or status <> 'recorded'::public.expense_status
  ),
  constraint expenses_paid_shape check (
    case
      when status = 'paid'::public.expense_status
        then paid_at is not null and ledger_entry_id is not null
      else true
    end
  ),
  constraint expenses_reversed_shape check (
    case
      when status = 'reversed'::public.expense_status
        then reversed_at is not null
          and length(btrim(coalesce(reversal_reason, ''))) > 0
      else reversed_at is null
    end
  )
);

create index if not exists expenses_school_date_idx
  on public.expenses (school_id, expense_date desc, created_at desc);
create index if not exists expenses_school_status_idx
  on public.expenses (school_id, status, expense_date desc);
create index if not exists expenses_fund_idx
  on public.expenses (school_id, fund_id, expense_date desc);
create index if not exists expenses_category_idx
  on public.expenses (school_id, category_id, expense_date desc);

-- ---------------------------------------------------------------------------
-- finance_transfers — always two ledger legs, written in one transaction
-- ---------------------------------------------------------------------------

create table if not exists public.finance_transfers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,

  transfer_date date not null,
  amount numeric(12, 2) not null,
  currency text not null default 'ZMW',
  from_account_id uuid not null references public.financial_accounts(id),
  to_account_id uuid not null references public.financial_accounts(id),
  description text not null,
  reference text,

  out_entry_id uuid references public.finance_ledger_entries(id),
  in_entry_id uuid references public.finance_ledger_entries(id),

  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null,
  reversal_reason text,

  constraint finance_transfers_amount_positive check (amount > 0),
  constraint finance_transfers_currency_zmw check (currency = 'ZMW'),
  constraint finance_transfers_distinct_accounts
    check (from_account_id <> to_account_id),
  constraint finance_transfers_description_present
    check (length(btrim(description)) > 0),
  -- A transfer is never one-sided (FIN-06).
  constraint finance_transfers_both_legs check (
    (out_entry_id is null and in_entry_id is null)
    or (out_entry_id is not null and in_entry_id is not null)
  ),
  constraint finance_transfers_reversed_shape check (
    (reversed_at is null and reversal_reason is null)
    or (reversed_at is not null and length(btrim(coalesce(reversal_reason, ''))) > 0)
  )
);

create index if not exists finance_transfers_school_date_idx
  on public.finance_transfers (school_id, transfer_date desc, created_at desc);
create index if not exists finance_transfers_from_idx
  on public.finance_transfers (from_account_id, transfer_date desc);
create index if not exists finance_transfers_to_idx
  on public.finance_transfers (to_account_id, transfer_date desc);

comment on table public.finance_transfers is
  'Movements between the school''s own accounts. Never income, never expenditure.';

-- ---------------------------------------------------------------------------
-- salary_payments — financial tracking only, not a statutory payroll engine
-- ---------------------------------------------------------------------------

create table if not exists public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,

  staff_id uuid not null references public.profiles(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  period_label text not null,

  gross_amount numeric(12, 2) not null,
  deductions_amount numeric(12, 2) not null default 0,
  net_amount numeric(12, 2) generated always as
    (gross_amount - deductions_amount) stored,
  currency text not null default 'ZMW',

  status public.salary_payment_status not null default 'draft',
  payment_date date,
  account_id uuid references public.financial_accounts(id),
  payment_method public.disbursement_method,
  reference text,
  notes text,

  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,

  ledger_entry_id uuid references public.finance_ledger_entries(id),

  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null,
  reversal_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint salary_payments_gross_positive check (gross_amount > 0),
  constraint salary_payments_deductions_valid
    check (deductions_amount >= 0 and deductions_amount <= gross_amount),
  constraint salary_payments_currency_zmw check (currency = 'ZMW'),
  constraint salary_payments_period_valid check (period_end >= period_start),
  constraint salary_payments_label_present check (length(btrim(period_label)) > 0),
  constraint salary_payments_paid_shape check (
    case
      when status = 'paid'::public.salary_payment_status
        then paid_at is not null
          and payment_date is not null
          and account_id is not null
          and ledger_entry_id is not null
      else true
    end
  ),
  constraint salary_payments_reversed_shape check (
    case
      when status = 'reversed'::public.salary_payment_status
        then reversed_at is not null
          and length(btrim(coalesce(reversal_reason, ''))) > 0
      else reversed_at is null
    end
  )
);

-- One live salary record per employee per pay period (FIN-12). A reversed
-- record is excluded so a genuine correction can be re-entered.
create unique index if not exists salary_payments_unique_period_uidx
  on public.salary_payments (school_id, staff_id, period_start, period_end)
  where status <> 'reversed'::public.salary_payment_status;

create index if not exists salary_payments_school_period_idx
  on public.salary_payments (school_id, period_start desc);
create index if not exists salary_payments_staff_idx
  on public.salary_payments (staff_id, period_start desc);
create index if not exists salary_payments_status_idx
  on public.salary_payments (school_id, status, period_start desc);

comment on table public.salary_payments is
  'Salary disbursement tracking. Sensitive: gated by FINANCE_SALARY_VIEW.';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists expense_categories_set_updated_at on public.expense_categories;
create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

drop trigger if exists salary_payments_set_updated_at on public.salary_payments;
create trigger salary_payments_set_updated_at
  before update on public.salary_payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Paid records are frozen. Corrections are reversals, never edits.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_enforce_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Expenses cannot be deleted. Reverse the expense instead.';
  end if;

  if old.status = 'reversed'::public.expense_status then
    raise exception 'A reversed expense cannot be changed.';
  end if;

  if old.status = 'paid'::public.expense_status
     and new.status <> 'reversed'::public.expense_status then
    raise exception 'A paid expense cannot be edited. Reverse it instead.';
  end if;

  -- The money itself never changes after approval.
  if old.status <> 'recorded'::public.expense_status
     and (new.amount is distinct from old.amount
          or new.fund_id is distinct from old.fund_id
          or new.category_id is distinct from old.category_id) then
    raise exception 'An approved expense cannot have its amount or fund changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_enforce_immutability on public.expenses;
create trigger expenses_enforce_immutability
  before update or delete on public.expenses
  for each row execute function public.expenses_enforce_immutability();

create or replace function public.salary_payments_enforce_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Salary records cannot be deleted. Reverse the record instead.';
  end if;

  if old.status = 'reversed'::public.salary_payment_status then
    raise exception 'A reversed salary record cannot be changed.';
  end if;

  if old.status = 'paid'::public.salary_payment_status
     and new.status <> 'reversed'::public.salary_payment_status then
    raise exception 'A paid salary cannot be edited. Reverse it instead.';
  end if;

  if old.status <> 'draft'::public.salary_payment_status
     and (new.gross_amount is distinct from old.gross_amount
          or new.deductions_amount is distinct from old.deductions_amount
          or new.staff_id is distinct from old.staff_id
          or new.period_start is distinct from old.period_start
          or new.period_end is distinct from old.period_end) then
    raise exception 'An approved salary record cannot have its amounts or period changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists salary_payments_enforce_immutability on public.salary_payments;
create trigger salary_payments_enforce_immutability
  before update or delete on public.salary_payments
  for each row execute function public.salary_payments_enforce_immutability();

create or replace function public.finance_transfers_enforce_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Transfers cannot be deleted. Reverse the transfer instead.';
  end if;
  if (new.amount, new.from_account_id, new.to_account_id, new.transfer_date)
     is distinct from
     (old.amount, old.from_account_id, old.to_account_id, old.transfer_date) then
    raise exception 'A completed transfer cannot be edited. Reverse it instead.';
  end if;
  if old.reversed_at is not null then
    raise exception 'This transfer has already been reversed.';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transfers_enforce_immutability on public.finance_transfers;
create trigger finance_transfers_enforce_immutability
  before update or delete on public.finance_transfers
  for each row execute function public.finance_transfers_enforce_immutability();

-- ---------------------------------------------------------------------------
-- Seed expense categories per school
-- ---------------------------------------------------------------------------

do $$
declare
  v_school record;
  v_general uuid;
  v_uniforms uuid;
  v_tuck uuid;
  v_meals uuid;
begin
  for v_school in select id from public.schools loop
    select id into v_general from public.finance_funds
      where school_id = v_school.id and code = 'GENERAL';
    select id into v_uniforms from public.finance_funds
      where school_id = v_school.id and code = 'UNIFORMS';
    select id into v_tuck from public.finance_funds
      where school_id = v_school.id and code = 'TUCK_SHOP';
    select id into v_meals from public.finance_funds
      where school_id = v_school.id and code = 'MEALS';

    insert into public.expense_categories
      (school_id, code, name, default_fund_id, is_salary, is_system, sort_order)
    values
      (v_school.id, 'SALARIES', 'Salaries', v_general, true, true, 10),
      (v_school.id, 'UTILITIES', 'Utilities (water, electricity)', v_general, false, true, 20),
      (v_school.id, 'TEACHING_MATERIALS', 'Teaching Materials', v_general, false, true, 30),
      (v_school.id, 'MAINTENANCE', 'Maintenance and Repairs', v_general, false, true, 40),
      (v_school.id, 'TRANSPORT', 'Transport', v_general, false, true, 50),
      (v_school.id, 'FOOD_CATERING', 'Food and Catering', v_meals, false, true, 60),
      (v_school.id, 'OFFICE_SUPPLIES', 'Office Supplies', v_general, false, true, 70),
      (v_school.id, 'CLEANING', 'Cleaning and Sanitation', v_general, false, true, 80),
      (v_school.id, 'INTERNET_AIRTIME', 'Internet and Airtime', v_general, false, true, 90),
      (v_school.id, 'BANK_CHARGES', 'Bank Charges', v_general, false, true, 100),
      (v_school.id, 'UNIFORM_PURCHASES', 'Uniform Purchases', v_uniforms, false, true, 110),
      (v_school.id, 'TUCK_SHOP_STOCK', 'Tuck Shop Stock', v_tuck, false, true, 120),
      (v_school.id, 'OTHER_EXPENSE', 'Other', v_general, false, true, 900)
    on conflict (school_id, code) do nothing;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.finance_transfers enable row level security;
alter table public.salary_payments enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_VIEW')
  );

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_EXPENSE_RECORD')
  );

drop policy if exists finance_transfers_select on public.finance_transfers;
create policy finance_transfers_select on public.finance_transfers
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_ACCOUNTS_VIEW')
  );

-- Salary rows are visible only with the salary capability. Secretary and
-- teacher have no path to this table, in the database, not just the UI.
drop policy if exists salary_payments_select on public.salary_payments;
create policy salary_payments_select on public.salary_payments
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.has_finance_capability('FINANCE_SALARY_VIEW')
  );

revoke insert, update, delete on public.expense_categories
  from authenticated, anon, public;
revoke insert, update, delete on public.expenses from authenticated, anon, public;
revoke insert, update, delete on public.finance_transfers
  from authenticated, anon, public;
revoke insert, update, delete on public.salary_payments
  from authenticated, anon, public;
revoke all on public.salary_payments from anon;

grant select on public.expense_categories to authenticated;
grant select on public.expenses to authenticated;
grant select on public.finance_transfers to authenticated;
grant select on public.salary_payments to authenticated;
