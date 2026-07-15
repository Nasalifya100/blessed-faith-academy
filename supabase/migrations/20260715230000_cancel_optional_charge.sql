-- ===========================================================================
-- Phase 7c: Cancel an optional meal/uniform charge
--
-- Lets staff remove an opt-in so a different meal plan can be chosen, or a
-- uniform charge can be withdrawn if it was added by mistake.
-- Only meal/uniform optional items; sets status = cancelled.
-- ===========================================================================

create or replace function public.cancel_optional_charge(
  p_charge_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id   uuid := public.current_user_school_id();
  v_category    public.fee_category;
  v_is_optional boolean;
  v_status      public.charge_status;
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to cancel optional charges.';
  end if;

  select fi.category, fi.is_optional, c.status
  into v_category, v_is_optional, v_status
  from public.charges c
  join public.fee_items fi on fi.id = c.fee_item_id
  where c.id = p_charge_id
    and c.school_id = v_school_id;

  if v_status is null then
    raise exception 'Charge was not found.';
  end if;

  if not v_is_optional or v_category not in ('meal', 'uniform') then
    raise exception 'Only optional meal or uniform charges can be cancelled here.';
  end if;

  if v_status = 'cancelled' then
    return;
  end if;

  update public.charges
  set status = 'cancelled'
  where id = p_charge_id;
end;
$$;
