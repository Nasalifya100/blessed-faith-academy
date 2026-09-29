-- ===========================================================================
-- Finance upgrade — Stage 5: reporting
--
-- Every figure below is derived from authoritative records at read time
-- (FIN-20). Nothing is cached, and no balance is computed in the browser.
--
-- Two sources are unioned, never duplicated:
--   * public.payments / payment_allocations  -> student money (receipted)
--   * public.finance_ledger_entries          -> everything else
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Student payment money, attributed to funds through the fee catalogue.
-- security_invoker keeps the caller's RLS in force.
-- ---------------------------------------------------------------------------

create or replace view public.finance_student_fund_income
with (security_invoker = true) as
select
  p.school_id,
  p.paid_on          as entry_date,
  fi.fund_id         as fund_id,
  acc.id             as account_id,
  pa.amount          as amount,
  p.id               as payment_id,
  p.receipt_number   as receipt_number,
  p.student_id       as student_id,
  p.method           as method
from public.payment_allocations pa
join public.payments p on p.id = pa.payment_id
join public.charges c on c.id = pa.charge_id
join public.fee_items fi on fi.id = c.fee_item_id
left join public.financial_accounts acc
  on acc.school_id = p.school_id
 and acc.default_for_method = p.method
where pa.reversed_at is null
  and p.status = 'completed'::public.payment_status;

comment on view public.finance_student_fund_income is
  'Receipted student money attributed to funds via fee_items.fund_id. Read-only.';

grant select on public.finance_student_fund_income to authenticated;

-- ---------------------------------------------------------------------------
-- Physical account balance.
--   opening balance
-- + ledger movements (expenses, transfers, non-student income)
-- + completed student payments that arrived by this account's method
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
    and (p_as_of is null or e.entry_date <= p_as_of);

  if v_account.default_for_method is null then
    v_student := 0;
  else
    select coalesce(sum(p.amount), 0) into v_student
    from public.payments p
    where p.school_id = v_school_id
      and p.method = v_account.default_for_method
      and p.status = 'completed'::public.payment_status
      and (p_as_of is null or p.paid_on <= p_as_of);
  end if;

  return (v_account.opening_balance + v_ledger + v_student)::numeric(12, 2);
end;
$$;

revoke all on function public.finance_account_balance(uuid, date)
  from public, anon;
grant execute on function public.finance_account_balance(uuid, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- All accounts with their balances.
-- ---------------------------------------------------------------------------

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
      public.finance_account_balance(a.id, null) as current_balance
    from public.financial_accounts a
    where a.school_id = v_school_id
  ) x;

  return jsonb_build_object(
    'accounts', v_accounts,
    'total_held', (
      select coalesce(sum((v->>'current_balance')::numeric), 0)
      from jsonb_array_elements(v_accounts) v
      where (v->>'is_active')::boolean
    )
  );
end;
$$;

revoke all on function public.get_financial_accounts_summary() from public, anon;
grant execute on function public.get_financial_accounts_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Fund positions: income, expenditure, and net, per fund, over a period.
-- ---------------------------------------------------------------------------

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
        - coalesce(led.ledger_expense, 0)) as net_position
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
        sum(e.expense_effect) as ledger_expense
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

revoke all on function public.get_finance_fund_positions(date, date)
  from public, anon;
grant execute on function public.get_finance_fund_positions(date, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Finance overview for the dashboard.
-- ---------------------------------------------------------------------------

create or replace function public.get_finance_overview(
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
  v_accounts jsonb;
  v_receivables numeric(12, 2);
  v_pending_expenses jsonb;
  v_transfer_total numeric(12, 2);
begin
  if not public.has_finance_capability('FINANCE_VIEW') then
    raise exception 'You are not authorized to view finance information.';
  end if;

  v_funds := case
    when public.has_finance_capability('FINANCE_FUNDS_VIEW')
      then public.get_finance_fund_positions(p_from, p_to)
    else null
  end;

  v_accounts := case
    when public.has_finance_capability('FINANCE_ACCOUNTS_VIEW')
      then public.get_financial_accounts_summary()
    else null
  end;

  -- Outstanding receivables: mandatory school fees only, so the figure is
  -- never inflated by optional purchases (FIN-09).
  select coalesce(sum(greatest(0, c.amount - public.charge_active_allocated(c.id))), 0)
  into v_receivables
  from public.charges c
  join public.fee_items fi on fi.id = c.fee_item_id
  join public.finance_funds f on f.id = fi.fund_id
  where c.school_id = v_school_id
    and f.is_school_fees
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    );

  select jsonb_build_object(
    'count', count(*),
    'amount', coalesce(sum(e.amount), 0)
  ) into v_pending_expenses
  from public.expenses e
  where e.school_id = v_school_id
    and e.status in (
      'recorded'::public.expense_status,
      'approved'::public.expense_status
    );

  select coalesce(sum(t.amount), 0) into v_transfer_total
  from public.finance_transfers t
  where t.school_id = v_school_id
    and t.reversed_at is null
    and (p_from is null or t.transfer_date >= p_from)
    and (p_to is null or t.transfer_date <= p_to);

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'funds', v_funds,
    'accounts', v_accounts,
    'outstanding_school_fees', v_receivables,
    'pending_expenses', coalesce(v_pending_expenses, jsonb_build_object('count', 0, 'amount', 0)),
    'transfers_total', v_transfer_total,
    'can_view_salaries', public.has_finance_capability('FINANCE_SALARY_VIEW')
  );
end;
$$;

revoke all on function public.get_finance_overview(date, date) from public, anon;
grant execute on function public.get_finance_overview(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-student split: mandatory School Fees vs additional purchases.
--
-- This is a NEW function. get_student_finance_summary is deliberately left
-- untouched so receipts, snapshots, and record_payment keep their existing
-- meaning (see docs/FINANCE_CURRENT_ARCHITECTURE_AUDIT.md §13).
-- ---------------------------------------------------------------------------

create or replace function public.get_student_finance_breakdown(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_active boolean;
  v_basis text;
  v_remaining numeric(12, 2);
  v_charge record;
  v_apply numeric(12, 2);
  v_fees_charged numeric(12, 2) := 0;
  v_fees_paid numeric(12, 2) := 0;
  v_additional jsonb := '{}'::jsonb;
  v_fund_key text;
  v_prev jsonb;
  v_total_payments numeric(12, 2);
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.school_id = v_school_id
  ) then
    raise exception 'Student was not found.';
  end if;

  v_active := public.finance_allocations_are_active(v_school_id);
  v_basis := case when v_active then 'allocations' else 'fifo_estimate' end;

  select coalesce(sum(p.amount), 0) into v_total_payments
  from public.payments p
  where p.student_id = p_student_id
    and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status;

  v_remaining := v_total_payments;

  -- Same charge ordering the allocation engine uses, so the legacy estimate
  -- matches what activation would produce.
  for v_charge in
    select
      c.id,
      c.amount,
      f.code as fund_code,
      f.name as fund_name,
      coalesce(f.is_school_fees, false) as is_school_fees,
      public.charge_active_allocated(c.id) as allocated
    from public.charges c
    join public.fee_items fi on fi.id = c.fee_item_id
    left join public.finance_funds f on f.id = fi.fund_id
    join public.academic_years ay on ay.id = c.academic_year_id
    left join public.terms t on t.id = c.term_id
    where c.school_id = v_school_id
      and c.student_id = p_student_id
      and c.status not in (
        'cancelled'::public.charge_status,
        'waived'::public.charge_status
      )
    order by
      coalesce(ay.start_date, ay.created_at::date) asc nulls last,
      coalesce(t.start_date, (date '2000-01-01' + ((coalesce(t.term_number, 1) - 1) * 90))) asc nulls last,
      c.created_at asc,
      c.id asc
  loop
    if v_active then
      v_apply := least(v_charge.amount, v_charge.allocated);
    else
      v_apply := least(v_charge.amount, greatest(0, v_remaining));
      v_remaining := greatest(0, v_remaining - v_apply);
    end if;

    if v_charge.is_school_fees then
      v_fees_charged := (v_fees_charged + v_charge.amount)::numeric(12, 2);
      v_fees_paid := (v_fees_paid + v_apply)::numeric(12, 2);
    else
      v_fund_key := coalesce(v_charge.fund_code, 'LEGACY_ADDITIONAL');
      v_prev := coalesce(
        v_additional -> v_fund_key,
        jsonb_build_object(
          'code', v_fund_key,
          'name', coalesce(v_charge.fund_name, 'Legacy Additional'),
          'charged', 0,
          'paid', 0
        )
      );
      v_additional := jsonb_set(
        v_additional,
        array[v_fund_key],
        jsonb_build_object(
          'code', v_fund_key,
          'name', v_prev->>'name',
          'charged', ((v_prev->>'charged')::numeric + v_charge.amount),
          'paid', ((v_prev->>'paid')::numeric + v_apply)
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'student_id', p_student_id,
    'basis', v_basis,
    'school_fees', jsonb_build_object(
      'charged', v_fees_charged,
      'paid', v_fees_paid,
      'outstanding', greatest(0, v_fees_charged - v_fees_paid)::numeric(12, 2)
    ),
    'additional', coalesce(
      (
        select jsonb_agg(
          value || jsonb_build_object(
            'outstanding',
            greatest(0, (value->>'charged')::numeric - (value->>'paid')::numeric)
          )
          order by value->>'name'
        )
        from jsonb_each(v_additional)
      ),
      '[]'::jsonb
    ),
    'additional_totals', jsonb_build_object(
      'charged', coalesce((
        select sum((value->>'charged')::numeric) from jsonb_each(v_additional)
      ), 0),
      'paid', coalesce((
        select sum((value->>'paid')::numeric) from jsonb_each(v_additional)
      ), 0),
      'outstanding', coalesce((
        select sum(greatest(0, (value->>'charged')::numeric - (value->>'paid')::numeric))
        from jsonb_each(v_additional)
      ), 0)
    )
  );
end;
$$;

revoke all on function public.get_student_finance_breakdown(uuid)
  from public, anon;
grant execute on function public.get_student_finance_breakdown(uuid)
  to authenticated;

comment on function public.get_student_finance_breakdown(uuid) is
  'Separates mandatory school fees from optional purchases. Additive to get_student_finance_summary.';
