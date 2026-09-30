-- ===========================================================================
-- Reject a new receipt whose paid_on is not a usable school date.
--
-- A new paid_on must be a real date with a four-digit year and must not be
-- after today in Africa/Lusaka. PostgreSQL already rejects impossible days
-- such as 31 February. This guard rejects a future day and a year that is
-- not four digits (for example 20266 or 92026).
--
-- BEFORE INSERT only. An UPDATE, including void_payment, does not run this
-- guard, so an existing future or wide-year receipt can still be read and
-- reversed. Existing rows are not rewritten.
-- ===========================================================================

create or replace function public.payment_paid_on_rejection(p_paid_on date)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_year int;
begin
  if p_paid_on is null then
    return 'A payment date is required.';
  end if;

  v_year := extract(year from p_paid_on)::int;
  if v_year < 1000 or v_year > 9999 then
    return 'The payment date must use a four-digit year.';
  end if;

  if p_paid_on > (now() at time zone 'Africa/Lusaka')::date then
    return 'The payment date cannot be after today.';
  end if;

  return null;
end;
$$;

comment on function public.payment_paid_on_rejection(date) is
  'Null when paid_on is a four-digit calendar date on or before today in Africa/Lusaka. Does not write.';

revoke all on function public.payment_paid_on_rejection(date) from public, anon;
grant execute on function public.payment_paid_on_rejection(date) to authenticated;

create or replace function public.payments_reject_future_paid_on()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rejection text;
begin
  v_rejection := public.payment_paid_on_rejection(new.paid_on);
  if v_rejection is not null then
    raise exception '%', v_rejection;
  end if;
  return new;
end;
$$;

comment on function public.payments_reject_future_paid_on() is
  'BEFORE INSERT guard for new receipts. Does not run on update, so a historical bad paid_on can still be voided.';

drop trigger if exists payments_reject_future_paid_on on public.payments;

create trigger payments_reject_future_paid_on
  before insert on public.payments
  for each row
  execute function public.payments_reject_future_paid_on();
