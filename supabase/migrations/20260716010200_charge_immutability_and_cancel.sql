-- ===========================================================================
-- Sprint 1 / Financial integrity: charge immutability + optional cancel guard
--
-- - Charges cannot be hard-deleted
-- - Financial identity fields frozen after insert
-- - Optional meal/uniform cancel only when outstanding AND balance-safe
-- ===========================================================================

drop policy if exists "charges_delete" on public.charges;

-- ---------------------------------------------------------------------------
-- Immutability: freeze identity/amount; allow status (+ updated_at) only when
-- session flag is set by cancel_optional_charge (or future controlled RPCs).
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
    'Charges are immutable. Use cancel_optional_charge to cancel an unpaid optional charge.';
end;
$$;

drop trigger if exists charges_enforce_immutability on public.charges;
create trigger charges_enforce_immutability
before update on public.charges
for each row
execute function public.charges_enforce_immutability();

-- Drop open UPDATE so clients cannot patch charges directly; RPCs use DEFINER
-- cancel path with session flag. Inserts still use INVOKER + charges_insert.
drop policy if exists "charges_update" on public.charges;

-- ---------------------------------------------------------------------------
-- cancel_optional_charge: outstanding + balance-safe unpaid rule
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
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to cancel optional charges.';
  end if;

  select c.student_id, fi.category, fi.is_optional, c.status
  into v_student_id, v_category, v_is_optional, v_status
  from public.charges c
  join public.fee_items fi on fi.id = c.fee_item_id
  where c.id = p_charge_id
    and c.school_id = v_school_id
  for update of c;

  if v_status is null then
    raise exception 'Charge was not found.';
  end if;

  if not v_is_optional or v_category not in ('meal', 'uniform') then
    raise exception 'Only optional meal or uniform charges can be cancelled here.';
  end if;

  if v_status = 'cancelled' then
    return;
  end if;

  if v_status <> 'outstanding' then
    raise exception
      'Only outstanding (unpaid) optional charges can be cancelled.';
  end if;

  -- Balance-safe unpaid: after cancel, completed payments must not exceed
  -- remaining billable charges (payments are unallocated).
  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where student_id = v_student_id
    and school_id = v_school_id
    and status = 'completed';

  select coalesce(sum(amount), 0) into v_remaining
  from public.charges
  where student_id = v_student_id
    and school_id = v_school_id
    and status not in ('cancelled', 'waived')
    and id <> p_charge_id;

  if v_paid > v_remaining then
    raise exception
      'Cannot cancel: payments already cover this charge. Reverse a payment first if needed.';
  end if;

  perform set_config('app.allow_charge_status_update', 'on', true);

  update public.charges
  set status = 'cancelled'
  where id = p_charge_id
    and school_id = v_school_id
    and status = 'outstanding';
end;
$$;

revoke all on function public.cancel_optional_charge(uuid) from public;
grant execute on function public.cancel_optional_charge(uuid) to authenticated;
