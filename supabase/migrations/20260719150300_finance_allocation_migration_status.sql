-- ===========================================================================
-- Phase 2 verification tooling: finance allocation migration status (read-only)
--
-- Does NOT activate allocations, run backfill, or change payment behaviour.
-- Administrator-only visibility for staging / cutover readiness checks.
-- ===========================================================================

alter table public.finance_allocation_gates
  add column if not exists activated_by uuid references public.profiles(id) on delete set null;

-- Ensure future activation records who enabled allocation mode (no behaviour change now).
create or replace function public.activate_payment_allocations(p_school_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate public.finance_allocation_gates%rowtype;
  v_validation jsonb;
  v_completed bigint;
begin
  if p_school_id is null then
    raise exception 'school_id is required.';
  end if;

  select * into v_gate
  from public.finance_allocation_gates
  where school_id = p_school_id;

  select count(*) into v_completed
  from public.payments
  where school_id = p_school_id
    and status = 'completed'::public.payment_status;

  if v_completed > 0 and (v_gate.school_id is null or v_gate.backfill_completed_at is null) then
    raise exception
      'Activation refused: backfill_completed_at is required when completed payments exist. Run controlled backfill first.';
  end if;

  v_validation := public.validate_payment_allocation_invariants_for_school(p_school_id);
  if not coalesce((v_validation->>'ok')::boolean, false) then
    raise exception 'Activation refused: invariant validation failed: %', v_validation;
  end if;

  insert into public.finance_allocation_gates as g (
    school_id, activated_at, activated_by, invariants_ok_at,
    last_validation, updated_at, updated_by
  ) values (
    p_school_id, now(), auth.uid(), now(), v_validation, now(), auth.uid()
  )
  on conflict (school_id) do update
  set
    activated_at = now(),
    activated_by = auth.uid(),
    invariants_ok_at = now(),
    last_validation = excluded.last_validation,
    updated_at = now(),
    updated_by = auth.uid();

  return jsonb_build_object(
    'school_id', p_school_id,
    'activated_at', now(),
    'validation', v_validation
  );
end;
$$;

revoke all on function public.activate_payment_allocations(uuid)
  from public, anon, authenticated;

comment on function public.activate_payment_allocations(uuid) is
  'SQL-console only. Enables allocation-based credit/outstanding for a school after backfill + invariants. Records activated_by.';

create or replace function public.get_finance_allocation_migration_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_schema_installed boolean := false;
  v_diagnostics_available boolean := false;
  v_diag jsonb := null;
  v_diag_error text := null;
  v_gate public.finance_allocation_gates%rowtype;
  v_activated_by_name text := null;
  v_blocking_count int := 0;
  v_warning_count int := 0;
  v_mode text := 'legacy';
  v_backfill_status text := 'not_started';
  v_validation_status text := 'not_run';
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not public.is_administrator() then
    raise exception 'Only an Administrator may view finance migration status.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  v_schema_installed := to_regclass('public.payment_allocations') is not null
    and to_regclass('public.finance_allocation_gates') is not null
    and to_regclass('public.finance_event_audits') is not null;

  v_diagnostics_available := to_regprocedure(
    'public.diagnose_finance_pre_allocation()'
  ) is not null;

  if v_schema_installed then
    select * into v_gate
    from public.finance_allocation_gates as g
    where g.school_id = v_school_id;
  end if;

  if v_diagnostics_available then
    begin
      v_diag := public.diagnose_finance_pre_allocation();
      v_blocking_count := coalesce((v_diag->>'blocking_issue_count')::int, 0);
      v_warning_count := coalesce((v_diag->>'warning_count')::int, 0);
    exception
      when others then
        v_diag_error := SQLERRM;
        v_diag := null;
    end;
  end if;

  if v_gate.activated_at is not null then
    v_mode := 'allocation_enabled';
  end if;

  if v_gate.backfill_completed_at is not null then
    v_backfill_status := 'completed';
  elsif v_schema_installed then
    v_backfill_status := 'not_started';
  else
    v_backfill_status := 'unavailable';
  end if;

  if v_gate.invariants_ok_at is not null then
    if coalesce((v_gate.last_validation->>'ok')::boolean, false) then
      v_validation_status := 'ok';
    elsif v_gate.last_validation is not null then
      v_validation_status := 'failed';
    else
      v_validation_status := 'recorded';
    end if;
  end if;

  if v_gate.activated_at is not null and v_gate.activated_by is not null then
    select p.full_name into v_activated_by_name
    from public.profiles as p
    where p.id = v_gate.activated_by;
  end if;

  return jsonb_build_object(
    'school_id', v_school_id,
    'finance_mode', v_mode,
    'allocation_schema_installed', v_schema_installed,
    'diagnostics_available', v_diagnostics_available,
    'diagnostic_error', v_diag_error,
    'diagnostic_result', case
      when v_diag is null then null
      else jsonb_build_object(
        'safe_to_backfill', coalesce((v_diag->>'safe_to_backfill')::boolean, false),
        'blocking_issue_count', v_blocking_count,
        'warning_count', v_warning_count,
        'completed_payments_count', coalesce((v_diag->>'completed_payments_count')::bigint, 0),
        'voided_payments_count', coalesce((v_diag->>'voided_payments_count')::bigint, 0),
        'active_charges_count', coalesce((v_diag->>'active_charges_count')::bigint, 0),
        'total_completed_payments', coalesce((v_diag->>'total_completed_payments')::numeric, 0),
        'total_active_charges', coalesce((v_diag->>'total_active_charges')::numeric, 0)
      )
    end,
    'blocking_issue_count', v_blocking_count,
    'warning_count', v_warning_count,
    'backfill_status', v_backfill_status,
    'backfill_completed_at', v_gate.backfill_completed_at,
    'validation_status', v_validation_status,
    'invariants_ok_at', v_gate.invariants_ok_at,
    'activation_status', case
      when v_gate.activated_at is not null then 'enabled'
      else 'legacy'
    end,
    'activated_at', v_gate.activated_at,
    'activated_by_name', v_activated_by_name,
    'gate_updated_at', v_gate.updated_at,
    'diagnostics_ok_at', v_gate.diagnostics_ok_at,
    'payment_allocation_readiness', (
      v_schema_installed
      and v_diagnostics_available
      and v_diag_error is null
      and v_blocking_count = 0
      and v_backfill_status = 'completed'
      and v_validation_status in ('ok', 'recorded')
    ),
    'available_credit_readiness', (v_gate.activated_at is not null),
    'checked_at', now()
  );
end;
$$;

revoke all on function public.get_finance_allocation_migration_status()
  from public, anon;
grant execute on function public.get_finance_allocation_migration_status()
  to authenticated;

comment on function public.get_finance_allocation_migration_status() is
  'Administrator-only read-only finance allocation migration readiness status. No secrets, no activation, no backfill.';
