-- ===========================================================================
-- The portal records a transfer with seven arguments, including
-- p_client_request_id. 20260930200000 created a second six-argument
-- record_account_transfer. A six-argument call is then ambiguous, and the
-- portal keeps using the older seven-argument function, which never takes
-- finance_lock_financial_accounts.
--
-- This replaces that seven-argument function and drops only the accidental
-- six-argument overload. Idempotency stays. Reverse transfer already has one
-- signature, (uuid, text), and 20260930200000 already locks it in the same
-- order, so its API is not replaced here.
--
-- Lock order for a transfer or its reversal:
--   1. school advisory lock hashtext(school_id || ':transfer')
--   2. both financial_accounts rows, ordered by account id
--   3. ledger legs
-- Opening initialization locks accounts in that same id order and does not
-- take the transfer advisory lock, so the two paths cannot invert those locks.
-- ===========================================================================

drop function public.record_account_transfer(
  uuid, uuid, numeric, date, text, text
);

create or replace function public.record_account_transfer(
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
  perform public.finance_lock_financial_accounts(array[p_from_account_id, p_to_account_id]);

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
