-- Read-only opening-balance inventory.
-- Do not insert, update, or delete. Do not run this file as a migration.
-- It uses the payment-date guard already installed in production.
-- It does not require the opening-initialization migration.
-- Suspicious dates are listed as a count. They do not block a statement count.
-- The amount to record is the external statement or physical cash count.

select
  a.code,
  a.name,
  a.is_active as active,
  a.opening_balance,
  a.opening_balance_date,
  case
    when a.opening_balance_date is not null then 'initialized'
    when exists (
      select 1
      from public.financial_accounts other
      where other.school_id = a.school_id
        and other.is_active
        and other.opening_balance_date is not null
    ) then 'blocked'
    when exists (
      select 1
      from public.payments p
      where p.financial_account_id = a.id
        and p.status = 'completed'
    ) or exists (
      select 1
      from public.finance_ledger_entries e
      where e.account_id = a.id
    ) then 'ready'
    else 'not_initialized'
  end as initialization_status,
  (
    select count(*)
    from public.payments p
    where p.financial_account_id = a.id
      and p.status = 'completed'
  ) as attributed_completed_receipt_count,
  (
    select coalesce(sum(p.amount), 0)
    from public.payments p
    where p.financial_account_id = a.id
      and p.status = 'completed'
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
      and p.status = 'completed'
      and public.payment_paid_on_rejection(p.paid_on) is not null
  ) as suspicious_receipt_count,
  (
    select min(d)
    from (
      select p.paid_on as d
      from public.payments p
      where p.financial_account_id = a.id and p.status = 'completed'
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
      where p.financial_account_id = a.id and p.status = 'completed'
      union all
      select e.entry_date
      from public.finance_ledger_entries e
      where e.account_id = a.id
    ) dates
  ) as latest_relevant_date
from public.financial_accounts a
order by a.code;
