-- ===========================================================================
-- Sprint 1 / Financial integrity: payment immutability + void (reversal)
--
-- - Completed payments cannot be deleted
-- - Financial fields on payments cannot be edited after insert
-- - void_payment soft-voids in place (status = voided), preserving the row
-- - Only can_manage_fees() may void; cannot void twice
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Void / reversal metadata (null until voided)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null;

comment on column public.payments.void_reason is
  'Mandatory reason when status becomes voided; set only by void_payment.';
comment on column public.payments.voided_at is
  'When the payment was reversed/voided.';
comment on column public.payments.voided_by is
  'Staff profile that reversed/voided the payment.';

-- ---------------------------------------------------------------------------
-- Remove hard-delete; remove open UPDATE (void goes through SECURITY DEFINER)
-- ---------------------------------------------------------------------------
drop policy if exists "payments_delete" on public.payments;
drop policy if exists "payments_update" on public.payments;

-- ---------------------------------------------------------------------------
-- Immutability trigger: block any direct UPDATE that is not a no-op.
-- void_payment is SECURITY DEFINER and sets session flag to allow the void.
-- ---------------------------------------------------------------------------
create or replace function public.payments_enforce_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Allow the controlled void path only
  if current_setting('app.allow_payment_void', true) = 'on' then
    -- Only completed → voided with metadata; financial fields frozen
    if old.status = 'completed'
       and new.status = 'voided'
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

  raise exception
    'Payments are immutable. Use void_payment to reverse a completed payment.';
end;
$$;

drop trigger if exists payments_enforce_immutability on public.payments;
create trigger payments_enforce_immutability
before update on public.payments
for each row
execute function public.payments_enforce_immutability();

-- ---------------------------------------------------------------------------
-- void_payment: reverse a completed payment atomically (soft-void)
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
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to reverse payments.';
  end if;

  if v_reason = '' then
    raise exception 'A reversal reason is required.';
  end if;

  if auth.uid() is null then
    raise exception 'You must be signed in to reverse a payment.';
  end if;

  select status into v_status
  from public.payments
  where id = p_payment_id
    and school_id = v_school_id
  for update;

  if v_status is null then
    raise exception 'Payment was not found.';
  end if;

  if v_status = 'voided' then
    raise exception 'This payment has already been reversed.';
  end if;

  if v_status <> 'completed' then
    raise exception 'Only completed payments can be reversed.';
  end if;

  perform set_config('app.allow_payment_void', 'on', true);

  update public.payments
  set
    status = 'voided',
    void_reason = v_reason,
    voided_at = now(),
    voided_by = auth.uid()
  where id = p_payment_id
    and school_id = v_school_id
    and status = 'completed'
  returning id into v_payment_id;

  if v_payment_id is null then
    raise exception 'Could not reverse payment.';
  end if;

  return v_payment_id;
end;
$$;

revoke all on function public.void_payment(uuid, text) from public;
grant execute on function public.void_payment(uuid, text) to authenticated;
