-- ===========================================================================
-- Fix: restore cancel_optional_charge privilege path after activation rewrite
--
-- Problem (20260719150200):
--   cancel_optional_charge was replaced as SECURITY INVOKER and updated
--   charges.status without set_config('app.allow_charge_status_update', 'on').
--   Charge immutability trigger + dropped charges_update RLS then block cancel.
--
-- Fix:
--   SECURITY DEFINER + transaction-local GUC, keeping allocation-aware unpaid
--   guard (refuse cancel when active allocations exist).
--
-- Does NOT change allocation, credit, receipts, reports, or activation state.
-- ===========================================================================

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
  v_category    public.fee_category;
  v_is_optional boolean;
  v_status      public.charge_status;
  v_allocated   numeric(12, 2);
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to cancel a charge.';
  end if;

  if not public.can_manage_fees() then
    raise exception 'You are not authorized to cancel optional charges.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select fi.category, fi.is_optional, c.status
  into v_category, v_is_optional, v_status
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

  -- Allocation-aware unpaid rule (post-activation): refuse if any active
  -- allocation remains on this charge. Callers must void/reverse payments first.
  v_allocated := public.charge_active_allocated(p_charge_id);
  if v_allocated > 0 then
    raise exception
      'This charge has payment allocations (K%). Reverse the related payment(s) before cancelling.',
      v_allocated;
  end if;

  -- Required for charges_immutable_bu trigger (and DEFINER bypass of missing UPDATE RLS).
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
  'SECURITY DEFINER soft-cancel for outstanding optional meal/uniform charges. Requires can_manage_fees(). Sets app.allow_charge_status_update. Refuses when active payment allocations exist.';

revoke all on function public.cancel_optional_charge(uuid) from public;
revoke all on function public.cancel_optional_charge(uuid) from anon;
grant execute on function public.cancel_optional_charge(uuid) to authenticated;
