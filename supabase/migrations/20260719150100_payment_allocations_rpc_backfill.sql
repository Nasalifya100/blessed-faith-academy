-- ===========================================================================
-- Phase 2 Stage C tools: controlled historical backfill (MANUAL ONLY)
--
-- THIS MIGRATION MUST NOT EXECUTE THE BACKFILL.
-- There is no DO $$ ... backfill $$ block here.
--
-- Locking order (deadlock-safe, consistent across RPCs):
--   1. pg_advisory_xact_lock(hashtext(school_id || ':' || student_id))
--   2. FOR UPDATE payment rows (paid_on, created_at, id)
--   3. FOR UPDATE charge rows inside allocate_payment_to_charges
--      (year start, term start, created_at, id)
--   4. INSERT payment_allocations
--
-- Idempotency:
--   remaining = payment.amount - sum(active allocations)
--   remaining < 0 => blocking error
--   remaining = 0 => done
--   remaining > 0 => allocate remainder (resume partial backfill)
-- ===========================================================================

-- Remove prior callable backfill grants / auto-run helpers if present
drop function if exists public.backfill_payment_allocations();
drop function if exists public.backfill_payment_allocations_for_school(uuid);

create or replace function public.prepare_payment_allocation_backfill(
  p_school_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diag jsonb;
begin
  v_diag := public.diagnose_finance_pre_allocation_for_school(p_school_id);

  insert into public.finance_allocation_gates as g (
    school_id, last_diagnostics, diagnostics_ok_at, updated_at
  ) values (
    p_school_id,
    v_diag,
    case when coalesce((v_diag->>'safe_to_backfill')::boolean, false)
      then now() else null end,
    now()
  )
  on conflict (school_id) do update
  set
    last_diagnostics = excluded.last_diagnostics,
    diagnostics_ok_at = excluded.diagnostics_ok_at,
    updated_at = now();

  if not coalesce((v_diag->>'safe_to_backfill')::boolean, false) then
    raise exception
      'prepare_payment_allocation_backfill refused: blocking diagnostic issues exist. Review diagnose output.';
  end if;

  return v_diag;
end;
$$;

revoke all on function public.prepare_payment_allocation_backfill(uuid)
  from public, anon, authenticated;

comment on function public.prepare_payment_allocation_backfill(uuid) is
  'SQL-console only. Runs diagnostics and records gate.diagnostics_ok_at when safe_to_backfill.';

create or replace function public.run_payment_allocation_backfill(
  p_school_id uuid,
  p_dry_run boolean default true,
  p_fail_fast boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diag jsonb;
  v_student record;
  v_payment record;
  v_remaining numeric(12, 2);
  v_allocated numeric(12, 2);
  v_payments_seen int := 0;
  v_payments_complete int := 0;
  v_payments_resumed int := 0;
  v_allocations_created int := 0;
  v_credit_remaining_payments int := 0;
  v_pupils_processed int := 0;
  v_pupils_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_before_count bigint;
  v_after_count bigint;
  v_validation jsonb;
begin
  if p_school_id is null then
    raise exception 'school_id is required.';
  end if;

  -- Re-diagnose; refuse on structural blocking issues.
  v_diag := public.diagnose_finance_pre_allocation_for_school(p_school_id);
  if not coalesce((v_diag->>'safe_to_backfill')::boolean, false) then
    raise exception
      'run_payment_allocation_backfill refused: safe_to_backfill=false. Run prepare/diagnose first.';
  end if;

  for v_student in
    select s.id
    from public.students as s
    where s.school_id = p_school_id
    order by s.id
  loop
    perform pg_advisory_xact_lock(
      hashtext(p_school_id::text || ':' || v_student.id::text)
    );

    begin
      -- Pupil relationship sanity (fail-safe)
      if exists (
        select 1 from public.payments p
        where p.student_id = v_student.id
          and p.school_id is distinct from p_school_id
      ) or exists (
        select 1 from public.charges c
        where c.student_id = v_student.id
          and c.school_id is distinct from p_school_id
      ) then
        raise exception 'Pupil % has cross-school payment/charge rows.', v_student.id;
      end if;

      for v_payment in
        select p.*
        from public.payments as p
        where p.school_id = p_school_id
          and p.student_id = v_student.id
          and p.status = 'completed'::public.payment_status
        order by p.paid_on asc, p.created_at asc, p.id asc
        for update of p
      loop
        v_payments_seen := v_payments_seen + 1;
        v_remaining := (
          v_payment.amount - public.payment_active_allocated(v_payment.id)
        )::numeric(12, 2);

        if v_remaining < 0 then
          raise exception
            'Payment % over-allocated (remaining %). Blocking.',
            v_payment.id, v_remaining;
        end if;

        if v_remaining = 0 then
          v_payments_complete := v_payments_complete + 1;
          continue;
        end if;

        if public.payment_active_allocated(v_payment.id) > 0 then
          v_payments_resumed := v_payments_resumed + 1;
        end if;

        if p_dry_run then
          -- Estimate only: do not insert rows.
          continue;
        end if;

        select count(*) into v_before_count
        from public.payment_allocations pa
        where pa.payment_id = v_payment.id and pa.reversed_at is null;

        v_allocated := public.allocate_payment_to_charges(
          v_payment.id,
          null,
          'backfill'
        );

        select count(*) into v_after_count
        from public.payment_allocations pa
        where pa.payment_id = v_payment.id and pa.reversed_at is null;

        v_allocations_created := v_allocations_created
          + greatest(0, v_after_count - v_before_count)::int;

        if (v_payment.amount - public.payment_active_allocated(v_payment.id)) > 0 then
          v_credit_remaining_payments := v_credit_remaining_payments + 1;
        else
          v_payments_complete := v_payments_complete + 1;
        end if;
      end loop;

      v_pupils_processed := v_pupils_processed + 1;
    exception
      when others then
        v_pupils_failed := v_pupils_failed + 1;
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'student_id', v_student.id,
          'sqlstate', SQLSTATE,
          'message', SQLERRM
        ));
        if p_fail_fast then
          raise;
        end if;
        -- Continue to next pupil only when fail_fast=false.
        -- Note: failed pupil changes in this iteration are aborted by exception
        -- propagation to this handler; outer transaction remains open.
    end;
  end loop;

  if p_dry_run then
    return jsonb_build_object(
      'mode', 'dry_run',
      'school_id', p_school_id,
      'diagnostics', v_diag,
      'pupils_processed', v_pupils_processed,
      'pupils_failed', v_pupils_failed,
      'payments_seen', v_payments_seen,
      'payments_already_complete', v_payments_complete,
      'payments_needing_resume', v_payments_resumed,
      'allocations_created', 0,
      'failures', v_failures,
      'note', 'Dry-run does not insert allocations. Re-run with p_dry_run := false.'
    );
  end if;

  if v_pupils_failed > 0 and p_fail_fast then
    raise exception 'Backfill aborted with pupil failures: %', v_failures;
  end if;

  v_validation := public.validate_payment_allocation_invariants_for_school(p_school_id);
  if not coalesce((v_validation->>'ok')::boolean, false) then
    raise exception
      'Post-backfill invariant validation failed; transaction will roll back. Details: %',
      v_validation;
  end if;

  insert into public.finance_allocation_gates as g (
    school_id,
    backfill_completed_at,
    invariants_ok_at,
    last_backfill,
    last_validation,
    updated_at
  ) values (
    p_school_id,
    now(),
    now(),
    jsonb_build_object(
      'payments_seen', v_payments_seen,
      'payments_complete', v_payments_complete,
      'payments_resumed', v_payments_resumed,
      'allocations_created', v_allocations_created,
      'credit_remaining_payments', v_credit_remaining_payments,
      'pupils_processed', v_pupils_processed,
      'pupils_failed', v_pupils_failed
    ),
    v_validation,
    now()
  )
  on conflict (school_id) do update
  set
    backfill_completed_at = excluded.backfill_completed_at,
    invariants_ok_at = excluded.invariants_ok_at,
    last_backfill = excluded.last_backfill,
    last_validation = excluded.last_validation,
    updated_at = now();

  perform public.log_finance_event(
    p_school_id,
    null,
    'historical_backfill',
    null, null, null, null, null, null,
    jsonb_build_object(
      'mode', 'manual_controlled',
      'payments_seen', v_payments_seen,
      'allocations_created', v_allocations_created,
      'pupils_processed', v_pupils_processed,
      'pupils_failed', v_pupils_failed
    )
  );

  return jsonb_build_object(
    'mode', 'executed',
    'school_id', p_school_id,
    'diagnostics', v_diag,
    'validation', v_validation,
    'pupils_processed', v_pupils_processed,
    'pupils_failed', v_pupils_failed,
    'payments_seen', v_payments_seen,
    'payments_complete', v_payments_complete,
    'payments_resumed', v_payments_resumed,
    'allocations_created', v_allocations_created,
    'credit_remaining_payments', v_credit_remaining_payments,
    'failures', v_failures
  );
end;
$$;

revoke all on function public.run_payment_allocation_backfill(uuid, boolean, boolean)
  from public, anon, authenticated;

comment on function public.run_payment_allocation_backfill(uuid, boolean, boolean) is
  'SQL-console / service-role ONLY. Never auto-run. Default dry_run=true. Resumes partial allocations by remaining amount.';

-- Convenience aliases (still revoked from browser clients)
create or replace function public.backfill_payment_allocations_for_school(
  p_school_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prepare_payment_allocation_backfill(p_school_id);
  return public.run_payment_allocation_backfill(p_school_id, false, true);
end;
$$;

revoke all on function public.backfill_payment_allocations_for_school(uuid)
  from public, anon, authenticated;
