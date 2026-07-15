-- ===========================================================================
-- Sprint 1 (Financial integrity) — charge immutability + optional cancel guard
--
-- File: 20260716010200_charge_immutability_and_cancel.sql
-- Prerequisites:
--   20260716010000_payment_immutability_and_void.sql
--   20260716010100_payment_idempotency.sql (recommended; not strictly required)
--
-- Goals:
--   * Preserve existing charge rows (no hard deletes, no amount rewrites).
--   * Remove normal DELETE / open UPDATE access to public.charges.
--   * Optional meal/uniform cancel only when status = outstanding AND
--     balance-safe (completed payments must not exceed remaining liability).
--   * Mandatory charges cannot be cancelled through this RPC.
--
-- SECURITY:
--   * cancel_optional_charge is SECURITY DEFINER because charges_update RLS
--     is dropped. It MUST set search_path = public, re-check can_manage_fees(),
--     and scope by school_id.
--   * Session GUC app.allow_charge_status_update is transaction-local and
--     required by the BEFORE UPDATE trigger.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove normal DELETE / open UPDATE
-- ---------------------------------------------------------------------------
drop policy if exists "charges_delete" on public.charges;
drop policy if exists "charges_update" on public.charges;

-- Defence in depth beyond RLS.
revoke delete on table public.charges from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger
--    Financial identity + amount frozen. Status may change only when the
--    session flag is set by a controlled RPC (cancel_optional_charge).
-- ---------------------------------------------------------------------------
create or replace function public.charges_enforce_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_charge_status_update', true) = 'on' then
    if new.amount = old.amount
       and new.currency = old.currency
       and new.student_id = old.student_id
       and new.school_id = old.school_id
       and new.fee_item_id = old.fee_item_id
       and new.academic_year_id = old.academic_year_id
       and new.term_id is not distinct from old.term_id
       and new.description is not distinct from old.description
       and new.created_by is not distinct from old.created_by
    then
      return new;
    end if;

    raise exception 'Invalid charge status update.';
  end if;

  raise exception
    'Charges are immutable. Use public.cancel_optional_charge to cancel an unpaid optional charge.';
end;
$$;

comment on function public.charges_enforce_immutability() is
  'SECURITY: BEFORE UPDATE guard. Only controlled RPCs with app.allow_charge_status_update may change status; financial fields stay frozen.';

drop trigger if exists charges_enforce_immutability on public.charges;

create trigger charges_enforce_immutability
before update on public.charges
for each row
execute function public.charges_enforce_immutability();

-- ---------------------------------------------------------------------------
-- 3. cancel_optional_charge — outstanding + balance-safe unpaid rule
-- ---------------------------------------------------------------------------
create or replace function public.cancel_optional_charge(
  p_charge_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id   uuid := public.current_user_school_id();
  v_student_id  uuid;
  v_category    public.fee_category;
  v_is_optional boolean;
  v_status      public.charge_status;
  v_paid        numeric(12, 2);
  v_remaining   numeric(12, 2);
begin
  -- Authorization: never trust the UI alone.
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to cancel optional charges.';
  end if;

  if auth.uid() is null then
    raise exception 'You must be signed in to cancel a charge.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select c.student_id, fi.category, fi.is_optional, c.status
  into v_student_id, v_category, v_is_optional, v_status
  from public.charges as c
  join public.fee_items as fi on fi.id = c.fee_item_id
  where c.id = p_charge_id
    and c.school_id = v_school_id
  for update of c;

  if v_status is null then
    raise exception 'Charge was not found.';
  end if;

  if not coalesce(v_is_optional, false)
     or v_category not in (
       'meal'::public.fee_category,
       'uniform'::public.fee_category
     )
  then
    raise exception 'Only optional meal or uniform charges can be cancelled here.';
  end if;

  -- Idempotent: already cancelled.
  if v_status = 'cancelled'::public.charge_status then
    return;
  end if;

  if v_status <> 'outstanding'::public.charge_status then
    raise exception
      'Only outstanding (unpaid) optional charges can be cancelled.';
  end if;

  -- Balance-safe unpaid rule (payments are unallocated to lines):
  -- after removing this charge, completed payments must not exceed
  -- remaining billable charges. Excludes voided payments.
  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments as p
  where p.student_id = v_student_id
    and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status;

  select coalesce(sum(c.amount), 0)
  into v_remaining
  from public.charges as c
  where c.student_id = v_student_id
    and c.school_id = v_school_id
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    )
    and c.id <> p_charge_id;

  if v_paid > v_remaining then
    raise exception
      'Cannot cancel: payments already cover this charge. Reverse a payment first if needed.';
  end if;

  perform set_config('app.allow_charge_status_update', 'on', true);

  update public.charges as c
  set status = 'cancelled'::public.charge_status
  where c.id = p_charge_id
    and c.school_id = v_school_id
    and c.status = 'outstanding'::public.charge_status;

  if not found then
    raise exception 'Could not cancel charge.';
  end if;
end;
$$;

comment on function public.cancel_optional_charge(uuid) is
  'SECURITY DEFINER soft-cancel for outstanding optional meal/uniform charges only. search_path=public. Requires can_manage_fees(). Balance-safe vs completed payments.';

revoke all on function public.cancel_optional_charge(uuid) from public;
revoke all on function public.cancel_optional_charge(uuid) from anon;
grant execute on function public.cancel_optional_charge(uuid) to authenticated;
