-- ===========================================================================
-- Phase 2 Stage E: Activate allocation-based payment RPCs
--
-- Apply ONLY after:
--   1) Stage A migrations
--   2) diagnose_finance_pre_allocation() reviewed
--   3) run_payment_allocation_backfill(..., false, true) succeeded
--   4) validate_payment_allocation_invariants() ok
-- Then:
--   select public.activate_payment_allocations('<school-uuid>');
-- Then deploy the compatible application.
--
-- Dual-mode record_payment:
--   * allocations inactive => legacy outstanding cap, no credit, no allocations
--   * allocations active   => full amount + FIFO allocate + credit remainder
-- ===========================================================================

alter table public.payment_allocations
  drop constraint if exists payment_allocations_payment_id_fkey;

alter table public.payment_allocations
  add constraint payment_allocations_payment_id_fkey
  foreign key (payment_id)
  references public.payments(id)
  on delete cascade;

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
    school_id, activated_at, invariants_ok_at, last_validation, updated_at
  ) values (
    p_school_id, now(), now(), v_validation, now()
  )
  on conflict (school_id) do update
  set
    activated_at = now(),
    invariants_ok_at = now(),
    last_validation = excluded.last_validation,
    updated_at = now();

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
  'SQL-console only. Enables allocation-based credit/outstanding for a school after backfill + invariants.';

-- Harden direct inserts (payment creation only via DEFINER RPC)
drop policy if exists "payments_insert" on public.payments;
revoke insert on table public.payments from anon, authenticated;

drop function if exists public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
);

create or replace function public.record_payment(
  p_student_id       uuid,
  p_amount           numeric,
  p_method           public.payment_method,
  p_idempotency_key  uuid,
  p_reference_number text default null,
  p_paid_on          date default ((now() at time zone 'Africa/Lusaka')::date),
  p_notes            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_active boolean;
  v_prefix text;
  v_year text;
  v_head text;
  v_seq int;
  v_receipt_number text;
  v_payment_id uuid;
  v_outstanding_before numeric(12, 2);
  v_outstanding_after numeric(12, 2);
  v_amount_allocated numeric(12, 2) := 0;
  v_credit_created numeric(12, 2) := 0;
  v_available_credit_after numeric(12, 2) := 0;
  v_summary jsonb;
  v_amount numeric(12, 2) := round(p_amount, 2);
  v_charged numeric(12, 2);
  v_paid numeric(12, 2);
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to record payments.';
  end if;
  if auth.uid() is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required to record a payment.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if v_amount <> p_amount then
    raise exception 'Payment amount must have at most two decimal places.';
  end if;

  v_active := public.finance_allocations_are_active(v_school_id);

  select p.id into v_payment_id
  from public.payments as p
  where p.school_id = v_school_id and p.idempotency_key = p_idempotency_key;
  if v_payment_id is not null then
    v_summary := public.get_student_finance_summary(
      (select student_id from public.payments where id = v_payment_id)
    );
    return jsonb_build_object(
      'payment_id', v_payment_id,
      'receipt_number', (select receipt_number from public.payments where id = v_payment_id),
      'amount_received', (select amount from public.payments where id = v_payment_id),
      'amount_allocated', public.payment_active_allocated(v_payment_id),
      'credit_created', greatest(
        0,
        (select amount from public.payments where id = v_payment_id)
          - public.payment_active_allocated(v_payment_id)
      ),
      'outstanding_before', null,
      'outstanding_after', (v_summary->>'outstanding_balance')::numeric,
      'available_credit_after', (v_summary->>'available_credit')::numeric,
      'replay', true,
      'allocations_active', v_active
    );
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.school_id = v_school_id
      and s.status = 'enrolled'::public.student_status
  ) then
    raise exception 'Student was not found or is not enrolled.';
  end if;

  -- Locking order: advisory -> payments (receipt) -> charges (allocate)
  perform pg_advisory_xact_lock(
    hashtext(v_school_id::text || ':' || p_student_id::text)
  );

  v_summary := public.get_student_finance_summary(p_student_id);
  v_outstanding_before := (v_summary->>'outstanding_balance')::numeric(12, 2);

  if not v_active then
    -- Legacy path (pre-activation): reject overpayment / zero-balance advances.
    select coalesce(sum(c.amount), 0) into v_charged
    from public.charges c
    where c.student_id = p_student_id and c.school_id = v_school_id
      and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status);
    select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
    where p.student_id = p_student_id and p.school_id = v_school_id
      and p.status = 'completed'::public.payment_status;
    v_outstanding_before := (v_charged - v_paid)::numeric(12, 2);
    if v_outstanding_before <= 0 then
      raise exception 'This student has no outstanding balance.';
    end if;
    if v_amount > v_outstanding_before then
      raise exception
        'Payment amount (K%) exceeds outstanding balance (K%). Partial payments are allowed up to the balance. Activate payment allocations after backfill to accept advance payments.',
        v_amount, v_outstanding_before;
    end if;
  end if;

  select coalesce(sch.receipt_prefix, 'R') into v_prefix
  from public.schools sch where sch.id = v_school_id;

  select ay.name into v_year
  from public.academic_years ay
  where ay.school_id = v_school_id and ay.is_current
  limit 1;
  if v_year is null then
    v_year := to_char((now() at time zone 'Africa/Lusaka')::date, 'YYYY');
  end if;
  v_head := v_prefix || '-' || v_year;

  perform 1 from public.payments p
  where p.school_id = v_school_id
    and p.receipt_number ~ ('^' || v_head || '-[0-9]+$')
  for update of p;

  select coalesce(max((regexp_replace(p.receipt_number, '^.*-', ''))::int), 0) + 1
  into v_seq
  from public.payments p
  where p.school_id = v_school_id
    and p.receipt_number ~ ('^' || v_head || '-[0-9]+$');

  v_receipt_number := v_head || '-' || lpad(v_seq::text, 4, '0');

  begin
    insert into public.payments (
      school_id, student_id, amount, method, reference_number, receipt_number,
      paid_on, notes, status, recorded_by, idempotency_key
    ) values (
      v_school_id, p_student_id, v_amount, p_method, nullif(p_reference_number, ''),
      v_receipt_number,
      coalesce(p_paid_on, (now() at time zone 'Africa/Lusaka')::date),
      nullif(p_notes, ''), 'completed'::public.payment_status, auth.uid(),
      p_idempotency_key
    ) returning id into v_payment_id;
  exception
    when unique_violation then
      select p.id into v_payment_id from public.payments p
      where p.school_id = v_school_id and p.idempotency_key = p_idempotency_key;
      if v_payment_id is not null then
        v_summary := public.get_student_finance_summary(p_student_id);
        return jsonb_build_object(
          'payment_id', v_payment_id,
          'receipt_number', (select receipt_number from public.payments where id = v_payment_id),
          'amount_received', (select amount from public.payments where id = v_payment_id),
          'amount_allocated', public.payment_active_allocated(v_payment_id),
          'credit_created', 0,
          'outstanding_before', null,
          'outstanding_after', (v_summary->>'outstanding_balance')::numeric,
          'available_credit_after', (v_summary->>'available_credit')::numeric,
          'replay', true,
          'allocations_active', v_active
        );
      end if;
      raise;
  end;

  if v_active then
    v_amount_allocated := public.allocate_payment_to_charges(
      v_payment_id, auth.uid(), 'payment'
    );
    v_credit_created := greatest(0, v_amount - v_amount_allocated)::numeric(12, 2);
  else
    v_amount_allocated := v_amount;
    v_credit_created := 0;
  end if;

  v_summary := public.get_student_finance_summary(p_student_id);
  v_outstanding_after := (v_summary->>'outstanding_balance')::numeric(12, 2);
  v_available_credit_after := (v_summary->>'available_credit')::numeric(12, 2);

  perform public.log_finance_event(
    v_school_id, p_student_id, 'payment_recorded', v_payment_id,
    null, null, v_amount, auth.uid(), null,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'amount_allocated', v_amount_allocated,
      'credit_created', v_credit_created,
      'allocations_active', v_active
    )
  );

  if v_active and v_credit_created > 0 then
    perform public.log_finance_event(
      v_school_id, p_student_id, 'advance_credit_created', v_payment_id,
      null, null, v_credit_created, auth.uid(), null,
      jsonb_build_object('source', 'payment')
    );
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_number', v_receipt_number,
    'amount_received', v_amount,
    'amount_allocated', v_amount_allocated,
    'credit_created', v_credit_created,
    'outstanding_before', v_outstanding_before,
    'outstanding_after', v_outstanding_after,
    'available_credit_after', v_available_credit_after,
    'replay', false,
    'allocations_active', v_active
  );
end;
$$;

revoke all on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) from public, anon;
grant execute on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) to authenticated;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_status public.payment_status;
  v_reason text := trim(coalesce(p_reason, ''));
  v_payment_id uuid;
  v_student_id uuid;
  v_amount numeric(12, 2);
  v_alloc_sum numeric(12, 2);
  v_credit numeric(12, 2);
  v_n int;
begin
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

  select p.status, p.student_id, p.amount
  into v_status, v_student_id, v_amount
  from public.payments p
  where p.id = p_payment_id and p.school_id = v_school_id
  for update of p;

  if v_status is null then raise exception 'Payment was not found.'; end if;
  if v_status = 'voided'::public.payment_status then
    raise exception 'This payment has already been reversed.';
  end if;
  if v_status <> 'completed'::public.payment_status then
    raise exception 'Only completed payments can be reversed.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_school_id::text || ':' || v_student_id::text)
  );

  v_alloc_sum := public.payment_active_allocated(p_payment_id);
  v_credit := greatest(0, v_amount - v_alloc_sum)::numeric(12, 2);

  update public.payment_allocations pa
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_reason
  where pa.payment_id = p_payment_id
    and pa.school_id = v_school_id
    and pa.reversed_at is null;
  get diagnostics v_n = row_count;

  perform set_config('app.allow_payment_void', 'on', true);
  update public.payments p
  set status = 'voided'::public.payment_status,
      void_reason = v_reason,
      voided_at = now(),
      voided_by = auth.uid()
  where p.id = p_payment_id and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status
  returning p.id into v_payment_id;

  if v_payment_id is null then
    raise exception 'Could not reverse payment.';
  end if;

  if v_n > 0 then
    perform public.log_finance_event(
      v_school_id, v_student_id, 'allocations_reversed', v_payment_id,
      null, null, v_alloc_sum, auth.uid(), v_reason,
      jsonb_build_object('allocations_reversed_count', v_n)
    );
  end if;

  perform public.log_finance_event(
    v_school_id, v_student_id, 'payment_voided', v_payment_id,
    null, null, v_amount, auth.uid(), v_reason,
    jsonb_build_object('allocations_reversed', v_alloc_sum, 'credit_removed', v_credit)
  );

  return v_payment_id;
end;
$$;

create or replace function public.apply_available_credit(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_payment record;
  v_total_applied numeric(12, 2) := 0;
  v_applied numeric(12, 2);
  v_before jsonb;
  v_after jsonb;
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to apply available credit.';
  end if;
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if not public.finance_allocations_are_active(v_school_id) then
    raise exception
      'Available credit cannot be applied until payment allocations are activated for this school.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_school_id::text || ':' || p_student_id::text)
  );

  v_before := public.get_student_finance_summary(p_student_id);
  if (v_before->>'available_credit')::numeric <= 0 then
    raise exception 'This student has no available credit to apply.';
  end if;
  if (v_before->>'outstanding_balance')::numeric <= 0 then
    raise exception 'This student has no outstanding charges to apply credit against.';
  end if;

  for v_payment in
    select p.*
    from public.payments p
    where p.school_id = v_school_id
      and p.student_id = p_student_id
      and p.status = 'completed'::public.payment_status
      and (p.amount - public.payment_active_allocated(p.id)) > 0
    order by p.paid_on asc, p.created_at asc, p.id asc
    for update of p
  loop
    v_applied := public.allocate_payment_to_charges(
      v_payment.id, auth.uid(), 'credit_apply'
    );
    v_total_applied := (v_total_applied + v_applied)::numeric(12, 2);
  end loop;

  if v_total_applied <= 0 then
    raise exception 'No credit could be applied.';
  end if;

  v_after := public.get_student_finance_summary(p_student_id);
  perform public.log_finance_event(
    v_school_id, p_student_id, 'credit_applied', null, null, null,
    v_total_applied, auth.uid(), null,
    jsonb_build_object(
      'available_credit_before', (v_before->>'available_credit')::numeric,
      'available_credit_after', (v_after->>'available_credit')::numeric,
      'outstanding_before', (v_before->>'outstanding_balance')::numeric,
      'outstanding_after', (v_after->>'outstanding_balance')::numeric
    )
  );

  return jsonb_build_object(
    'student_id', p_student_id,
    'credit_applied', v_total_applied,
    'available_credit_before', (v_before->>'available_credit')::numeric,
    'available_credit_after', (v_after->>'available_credit')::numeric,
    'outstanding_before', (v_before->>'outstanding_balance')::numeric,
    'outstanding_after', (v_after->>'outstanding_balance')::numeric
  );
end;
$$;

revoke all on function public.apply_available_credit(uuid) from public, anon;
grant execute on function public.apply_available_credit(uuid) to authenticated;

create or replace function public.get_void_payment_preview(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_payment public.payments%rowtype;
  v_alloc numeric(12, 2);
  v_credit numeric(12, 2);
  v_summary jsonb;
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to preview payment reversals.';
  end if;
  select * into v_payment from public.payments p
  where p.id = p_payment_id and p.school_id = v_school_id;
  if v_payment.id is null then
    raise exception 'Payment was not found.';
  end if;
  v_alloc := public.payment_active_allocated(v_payment.id);
  v_credit := case
    when v_payment.status = 'completed'::public.payment_status
      then greatest(0, v_payment.amount - v_alloc)
    else 0 end;
  v_summary := public.get_student_finance_summary(v_payment.student_id);
  return jsonb_build_object(
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'amount_received', v_payment.amount,
    'allocations_to_reverse', v_alloc,
    'credit_to_remove', v_credit,
    'outstanding_before', (v_summary->>'outstanding_balance')::numeric,
    'outstanding_after_estimate',
      ((v_summary->>'outstanding_balance')::numeric + v_alloc)::numeric(12, 2),
    'available_credit_before', (v_summary->>'available_credit')::numeric,
    'available_credit_after_estimate',
      greatest(0, (v_summary->>'available_credit')::numeric - v_credit)::numeric(12, 2)
  );
end;
$$;

revoke all on function public.get_void_payment_preview(uuid) from public, anon;
grant execute on function public.get_void_payment_preview(uuid) to authenticated;

create or replace function public.cancel_optional_charge(p_charge_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_category public.fee_category;
  v_is_optional boolean;
  v_status public.charge_status;
  v_allocated numeric(12, 2);
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to cancel optional charges.';
  end if;
  select fi.category, fi.is_optional, c.status
  into v_category, v_is_optional, v_status
  from public.charges c
  join public.fee_items fi on fi.id = c.fee_item_id
  where c.id = p_charge_id and c.school_id = v_school_id;
  if v_status is null then raise exception 'Charge was not found.'; end if;
  if not v_is_optional or v_category not in ('meal', 'uniform') then
    raise exception 'Only optional meal or uniform charges can be cancelled here.';
  end if;
  if v_status = 'cancelled' then return; end if;
  v_allocated := public.charge_active_allocated(p_charge_id);
  if v_allocated > 0 then
    raise exception
      'This charge has payment allocations (K%). Reverse the related payment(s) before cancelling.',
      v_allocated;
  end if;
  update public.charges set status = 'cancelled' where id = p_charge_id;
end;
$$;

-- Production reset: wipe finance children before payments/charges
create or replace function public.reset_bfa_operational_data(
  p_dry_run boolean default true,
  p_school_name text default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_actor_id uuid := auth.uid();
  v_school_name text;
  v_counts jsonb;
  v_deleted jsonb;
  v_preserved jsonb;
  v_validation jsonb;
  v_n bigint;
  c_attendance_audits bigint;
  c_attendance bigint;
  c_discipline bigint;
  c_req_checks bigint;
  c_medical bigint;
  c_applications bigint;
  c_enrolments bigint;
  c_student_guardians bigint;
  c_finance_audits bigint;
  c_allocations bigint;
  c_payments bigint;
  c_charges bigint;
  c_legacy_audits bigint;
  c_students bigint;
  c_guardians bigint;
  c_covers bigint;
  p_profiles bigint;
  p_years bigint;
  p_terms bigint;
  p_grades bigint;
  p_classes bigint;
  p_fee_items bigint;
  p_fee_schedules bigint;
  p_req_items bigint;
  p_rules bigint;
  p_schools bigint;
begin
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if not public.is_administrator() then
    raise exception 'Only an Administrator may run Production Reset.';
  end if;
  if coalesce(trim(p_school_name), '') is distinct from 'Blessed Faith Academy' then
    raise exception 'School name confirmation is incorrect.';
  end if;
  if coalesce(trim(p_confirmation), '') is distinct from 'RESET BFA PRODUCTION DATA' then
    raise exception 'Confirmation phrase is incorrect.';
  end if;
  select s.name into v_school_name from public.schools s where s.id = v_school_id;
  if v_school_name is distinct from 'Blessed Faith Academy' then
    raise exception 'This reset is only configured for Blessed Faith Academy.';
  end if;

  select count(*) into c_attendance_audits from public.attendance_record_audits where school_id = v_school_id;
  select count(*) into c_attendance from public.attendance_records where school_id = v_school_id;
  select count(*) into c_discipline from public.discipline_incidents where school_id = v_school_id;
  select count(*) into c_req_checks from public.student_requirement_checks where school_id = v_school_id;
  select count(*) into c_medical from public.student_medical where school_id = v_school_id;
  select count(*) into c_applications from public.applications where school_id = v_school_id;
  select count(*) into c_enrolments from public.student_class_enrollments where school_id = v_school_id;
  select count(*) into c_student_guardians from public.student_guardians where school_id = v_school_id;
  select count(*) into c_finance_audits from public.finance_event_audits where school_id = v_school_id;
  select count(*) into c_allocations from public.payment_allocations where school_id = v_school_id;
  select count(*) into c_payments from public.payments where school_id = v_school_id;
  select count(*) into c_charges from public.charges where school_id = v_school_id;
  select count(*) into c_legacy_audits from public.legacy_migration_audits where school_id = v_school_id;
  select count(*) into c_students from public.students where school_id = v_school_id;
  select count(*) into c_guardians from public.guardians where school_id = v_school_id;
  select count(*) into c_covers from public.class_attendance_covers where school_id = v_school_id;

  select count(*) into p_schools from public.schools where id = v_school_id;
  select count(*) into p_profiles from public.profiles where school_id = v_school_id;
  select count(*) into p_years from public.academic_years where school_id = v_school_id;
  select count(*) into p_terms from public.terms where school_id = v_school_id;
  select count(*) into p_grades from public.grade_levels where school_id = v_school_id;
  select count(*) into p_classes from public.classes where school_id = v_school_id;
  select count(*) into p_fee_items from public.fee_items where school_id = v_school_id;
  select count(*) into p_fee_schedules from public.fee_schedules where school_id = v_school_id;
  select count(*) into p_req_items from public.requirement_items where school_id = v_school_id;
  select count(*) into p_rules from public.school_rules where school_id = v_school_id;

  v_counts := jsonb_build_object(
    'attendance_record_audits', c_attendance_audits,
    'attendance_records', c_attendance,
    'discipline_incidents', c_discipline,
    'student_requirement_checks', c_req_checks,
    'student_medical', c_medical,
    'applications', c_applications,
    'student_class_enrollments', c_enrolments,
    'student_guardians', c_student_guardians,
    'finance_event_audits', c_finance_audits,
    'payment_allocations', c_allocations,
    'payments', c_payments,
    'charges', c_charges,
    'legacy_migration_audits', c_legacy_audits,
    'students', c_students,
    'guardians', c_guardians,
    'class_attendance_covers', c_covers
  );
  v_preserved := jsonb_build_object(
    'schools', p_schools, 'profiles', p_profiles, 'academic_years', p_years,
    'terms', p_terms, 'grade_levels', p_grades, 'classes', p_classes,
    'fee_items', p_fee_items, 'fee_schedules', p_fee_schedules,
    'requirement_items', p_req_items, 'school_rules', p_rules
  );

  if p_dry_run then
    insert into public.system_reset_audits (school_id, actor_id, dry_run, payload)
    values (v_school_id, v_actor_id, true, jsonb_build_object(
      'event', 'production_reset_dry_run', 'to_delete', v_counts, 'preserved', v_preserved
    ));
    return jsonb_build_object('mode', 'dry_run', 'to_delete', v_counts, 'preserved', v_preserved);
  end if;

  delete from public.attendance_record_audits where school_id = v_school_id;
  delete from public.attendance_records where school_id = v_school_id;
  delete from public.discipline_incidents where school_id = v_school_id;
  delete from public.student_requirement_checks where school_id = v_school_id;
  delete from public.student_medical where school_id = v_school_id;
  delete from public.applications where school_id = v_school_id;
  delete from public.student_class_enrollments where school_id = v_school_id;
  delete from public.student_guardians where school_id = v_school_id;
  delete from public.finance_event_audits where school_id = v_school_id;
  get diagnostics v_n = row_count; c_finance_audits := v_n;
  delete from public.payment_allocations where school_id = v_school_id;
  get diagnostics v_n = row_count; c_allocations := v_n;
  delete from public.finance_allocation_gates where school_id = v_school_id;
  delete from public.payments where school_id = v_school_id;
  get diagnostics v_n = row_count; c_payments := v_n;
  delete from public.charges where school_id = v_school_id;
  get diagnostics v_n = row_count; c_charges := v_n;
  delete from public.legacy_migration_audits where school_id = v_school_id;
  delete from public.students where school_id = v_school_id;
  get diagnostics v_n = row_count; c_students := v_n;
  delete from public.guardians where school_id = v_school_id;
  delete from public.class_attendance_covers where school_id = v_school_id;

  v_deleted := jsonb_build_object(
    'finance_event_audits', c_finance_audits,
    'payment_allocations', c_allocations,
    'payments', c_payments,
    'charges', c_charges,
    'students', c_students
  );

  select count(*) into c_students from public.students where school_id = v_school_id;
  select count(*) into c_payments from public.payments where school_id = v_school_id;
  select count(*) into c_charges from public.charges where school_id = v_school_id;
  if c_students <> 0 or c_payments <> 0 or c_charges <> 0 then
    raise exception 'Post-reset validation failed: operational finance/student data remains.';
  end if;

  v_validation := jsonb_build_object('ok', true, 'students', c_students, 'payments', c_payments, 'charges', c_charges);
  insert into public.system_reset_audits (school_id, actor_id, dry_run, payload)
  values (v_school_id, v_actor_id, false, jsonb_build_object(
    'event', 'production_reset_executed', 'deleted', v_deleted, 'preserved', v_preserved, 'validation', v_validation
  ));

  return jsonb_build_object(
    'mode', 'executed',
    'deleted', v_deleted,
    'preserved', v_preserved,
    'validation', v_validation,
    'reminder', 'Set ALLOW_PRODUCTION_RESET=false and redeploy after this reset.'
  );
end;
$$;
