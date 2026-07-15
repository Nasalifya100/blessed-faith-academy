-- ===========================================================================
-- Sprint 1 (Financial integrity) — payment immutability + soft reversal
--
-- File: 20260716010000_payment_immutability_and_void.sql
--
-- Goals:
--   * Preserve every existing payment row (no deletes, no amount rewrites).
--   * Remove normal DELETE / open UPDATE access to public.payments.
--   * Allow atomic soft-reversal via public.void_payment only.
--   * Reversed payments keep status = 'voided' so balances that filter
--     status = 'completed' automatically exclude them.
--
-- Authorization: public.can_manage_fees()
--   → administrator | bursar | headteacher (active profiles only).
--
-- SECURITY:
--   * void_payment is SECURITY DEFINER so it can UPDATE after we drop the
--     open payments_update RLS policy. It MUST keep search_path = public
--     and re-check can_manage_fees() + school_id before writing.
--   * The BEFORE UPDATE trigger blocks any other mutation path (including
--     accidental DEFINER code that forgets the session flag).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Reversal metadata (nullable → existing completed payments unchanged)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid
    references public.profiles (id) on delete set null;

comment on column public.payments.void_reason is
  'Required non-empty reason when status becomes voided. Set only by public.void_payment.';
comment on column public.payments.voided_at is
  'Timestamp when the payment was reversed. Null while status = completed.';
comment on column public.payments.voided_by is
  'profiles.id of the fee manager who reversed the payment.';

-- Enforce void integrity at rest (does not rewrite historical completed rows).
alter table public.payments
  drop constraint if exists payments_void_metadata_chk;

alter table public.payments
  add constraint payments_void_metadata_chk
  check (
    status <> 'voided'::public.payment_status
    or (
      void_reason is not null
      and length(trim(void_reason)) > 0
      and voided_at is not null
      and voided_by is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Remove normal DELETE / open UPDATE (RLS + privilege)
--    SELECT and INSERT remain: school-scoped select; insert for fee managers
--    via public.record_payment / payments_insert policy.
-- ---------------------------------------------------------------------------
drop policy if exists "payments_delete" on public.payments;
drop policy if exists "payments_update" on public.payments;

-- Defence in depth: even if a future policy is mis-added, table privilege
-- should not allow authenticated clients to DELETE payment rows.
revoke delete on table public.payments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Immutability trigger
--    Blocks direct mutation of financial fields. The only permitted UPDATE is
--    completed → voided with frozen money/identity columns, when the session
--    local GUC app.allow_payment_void = 'on' (set by void_payment only).
-- ---------------------------------------------------------------------------
create or replace function public.payments_enforce_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Controlled path used exclusively by public.void_payment (transaction-local).
  if current_setting('app.allow_payment_void', true) = 'on' then
    if old.status = 'completed'::public.payment_status
       and new.status = 'voided'::public.payment_status
       and new.amount = old.amount
       and new.currency = old.currency
       and new.method = old.method
       and new.receipt_number = old.receipt_number
       and new.student_id = old.student_id
       and new.school_id = old.school_id
       and new.paid_on = old.paid_on
       and new.recorded_by is not distinct from old.recorded_by
       and new.reference_number is not distinct from old.reference_number
       and new.notes is not distinct from old.notes
       and new.void_reason is not null
       and length(trim(new.void_reason)) > 0
       and new.voided_at is not null
       and new.voided_by is not null
    then
      return new;
    end if;

    raise exception 'Invalid payment void update.';
  end if;

  -- Any other UPDATE (PostgREST, SQL editor as non-owner path, etc.) is denied.
  raise exception
    'Payments are immutable. Use public.void_payment to reverse a completed payment.';
end;
$$;

comment on function public.payments_enforce_immutability() is
  'SECURITY: BEFORE UPDATE guard. Only void_payment may change payments, and only completed→voided with frozen financial fields.';

drop trigger if exists payments_enforce_immutability on public.payments;

create trigger payments_enforce_immutability
before update on public.payments
for each row
execute function public.payments_enforce_immutability();

-- ---------------------------------------------------------------------------
-- 4. Atomic soft-reversal RPC
--    - Requires non-empty reason
--    - Locks the row (FOR UPDATE) to prevent double reversal races
--    - Sets status = voided; never deletes; never changes amount/receipt
--    - Restricted to can_manage_fees() and the caller's school
-- ---------------------------------------------------------------------------
create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id  uuid := public.current_user_school_id();
  v_status     public.payment_status;
  v_reason     text := trim(coalesce(p_reason, ''));
  v_payment_id uuid;
begin
  -- Authorization: never trust the UI; re-check role + active profile.
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to reverse payments.';
  end if;

  if auth.uid() is null then
    raise exception 'You must be signed in to reverse a payment.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  if v_reason = '' then
    raise exception 'A reversal reason is required.';
  end if;

  -- Lock the target row in the caller's school (prevents concurrent double void).
  select p.status
  into v_status
  from public.payments as p
  where p.id = p_payment_id
    and p.school_id = v_school_id
  for update of p;

  if v_status is null then
    raise exception 'Payment was not found.';
  end if;

  if v_status = 'voided'::public.payment_status then
    raise exception 'This payment has already been reversed.';
  end if;

  if v_status <> 'completed'::public.payment_status then
    raise exception 'Only completed payments can be reversed.';
  end if;

  -- Transaction-local flag consumed by payments_enforce_immutability.
  perform set_config('app.allow_payment_void', 'on', true);

  update public.payments as p
  set
    status = 'voided'::public.payment_status,
    void_reason = v_reason,
    voided_at = now(),
    voided_by = auth.uid()
  where p.id = p_payment_id
    and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status
  returning p.id into v_payment_id;

  if v_payment_id is null then
    raise exception 'Could not reverse payment.';
  end if;

  return v_payment_id;
end;
$$;

comment on function public.void_payment(uuid, text) is
  'SECURITY DEFINER soft-reversal. search_path=public. Requires can_manage_fees(). Never deletes. Balances exclude rows with status voided.';

-- Least privilege: callable by signed-in users; authz is inside the function.
revoke all on function public.void_payment(uuid, text) from public;
revoke all on function public.void_payment(uuid, text) from anon;
grant execute on function public.void_payment(uuid, text) to authenticated;
