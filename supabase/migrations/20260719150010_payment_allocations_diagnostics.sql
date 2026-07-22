-- ===========================================================================
-- Phase 2 Stage A (supplement): diagnostics + invariant validation
-- Applied after 20260719150000_payment_allocations_schema.sql
-- Does NOT backfill or activate overpayment RPCs.
-- ===========================================================================

create or replace function public.diagnose_finance_pre_allocation_for_school(
  p_school_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_count bigint;
  v_completed_payments bigint;
  v_active_charges bigint;
  v_voided_payments bigint;
  v_total_payments numeric(12, 2);
  v_total_charges numeric(12, 2);
  v_current_year_id uuid;
  v_warnings jsonb := '[]'::jsonb;
  v_blocking jsonb := '[]'::jsonb;
  v_tmp jsonb;
  v_warning_count int := 0;
  v_blocking_count int := 0;
begin
  if p_school_id is null then
    raise exception 'school_id is required.';
  end if;

  select count(*) into v_school_count from public.schools where id = p_school_id;
  if v_school_count = 0 then
    raise exception 'School was not found.';
  end if;

  select ay.id into v_current_year_id
  from public.academic_years as ay
  where ay.school_id = p_school_id and ay.is_current
  limit 1;

  select count(*), coalesce(sum(p.amount), 0)
  into v_completed_payments, v_total_payments
  from public.payments as p
  where p.school_id = p_school_id
    and p.status = 'completed'::public.payment_status;

  select count(*), coalesce(sum(c.amount), 0)
  into v_active_charges, v_total_charges
  from public.charges as c
  where c.school_id = p_school_id
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    );

  select count(*) into v_voided_payments
  from public.payments as p
  where p.school_id = p_school_id
    and p.status = 'voided'::public.payment_status;

  -- WARNINGS ---------------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select s.id as student_id, s.admission_number, pay.total_paid, chg.total_charged,
           (pay.total_paid - chg.total_charged) as excess
    from public.students s
    left join lateral (
      select coalesce(sum(p.amount), 0) as total_paid from public.payments p
      where p.student_id = s.id and p.status = 'completed'::public.payment_status
    ) pay on true
    left join lateral (
      select coalesce(sum(c.amount), 0) as total_charged from public.charges c
      where c.student_id = s.id
        and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
    ) chg on true
    where s.school_id = p_school_id and pay.total_paid > chg.total_charged
    order by s.admission_number limit 500
  ) x;
  v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
    'code', 'pupils_payments_exceed_charges', 'severity', 'warning', 'blocking', false, 'rows', v_tmp
  ));

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select s.id as student_id, s.admission_number,
           (coalesce(chg.total_charged, 0) - coalesce(pay.total_paid, 0)) as legacy_balance
    from public.students s
    left join lateral (
      select coalesce(sum(p.amount), 0) as total_paid from public.payments p
      where p.student_id = s.id and p.status = 'completed'::public.payment_status
    ) pay on true
    left join lateral (
      select coalesce(sum(c.amount), 0) as total_charged from public.charges c
      where c.student_id = s.id
        and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
    ) chg on true
    where s.school_id = p_school_id
      and (coalesce(chg.total_charged, 0) - coalesce(pay.total_paid, 0)) < 0
    order by s.admission_number limit 500
  ) x;
  v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
    'code', 'pupils_negative_legacy_balance', 'severity', 'warning', 'blocking', false, 'rows', v_tmp
  ));

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select s.id as student_id, s.admission_number,
           cy.year_charged, lt.lifetime_charged, pay.total_paid,
           (cy.year_charged - pay.total_paid) as ui_style_balance,
           (lt.lifetime_charged - pay.total_paid) as lifetime_balance
    from public.students s
    left join lateral (
      select coalesce(sum(c.amount), 0) as year_charged from public.charges c
      where c.student_id = s.id and c.academic_year_id = v_current_year_id
        and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
    ) cy on true
    left join lateral (
      select coalesce(sum(c.amount), 0) as lifetime_charged from public.charges c
      where c.student_id = s.id
        and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
    ) lt on true
    left join lateral (
      select coalesce(sum(p.amount), 0) as total_paid from public.payments p
      where p.student_id = s.id and p.status = 'completed'::public.payment_status
    ) pay on true
    where s.school_id = p_school_id
      and v_current_year_id is not null
      and (cy.year_charged - pay.total_paid)
        is distinct from (lt.lifetime_charged - pay.total_paid)
    order by s.admission_number limit 500
  ) x;
  v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
    'code', 'pupils_current_year_vs_lifetime_mismatch',
    'severity', 'warning', 'blocking', false, 'rows', v_tmp
  ));

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select p.id as payment_id, p.student_id, p.amount,
           public.payment_active_allocated(p.id) as active_allocated,
           (p.amount - public.payment_active_allocated(p.id)) as remaining
    from public.payments p
    where p.school_id = p_school_id
      and p.status = 'completed'::public.payment_status
      and public.payment_active_allocated(p.id) > 0
      and public.payment_active_allocated(p.id) < p.amount
    order by p.paid_on, p.id limit 500
  ) x;
  v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
    'code', 'partially_allocated_payments', 'severity', 'warning', 'blocking', false, 'rows', v_tmp
  ));

  -- BLOCKING ---------------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select p.id as payment_id, p.school_id as payment_school_id,
           s.school_id as student_school_id, p.student_id
    from public.payments p
    join public.students s on s.id = p.student_id
    where p.school_id = p_school_id and p.school_id is distinct from s.school_id
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'payment_student_school_mismatch', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select c.id as charge_id, c.school_id as charge_school_id,
           s.school_id as student_school_id, c.student_id
    from public.charges c
    join public.students s on s.id = c.student_id
    where c.school_id = p_school_id and c.school_id is distinct from s.school_id
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'charge_student_school_mismatch', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select p.receipt_number, count(*)::int as dup_count
    from public.payments p
    where p.school_id = p_school_id
    group by p.receipt_number having count(*) > 1
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'duplicate_receipt_numbers', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select p.idempotency_key, count(*)::int as dup_count
    from public.payments p
    where p.school_id = p_school_id and p.idempotency_key is not null
    group by p.idempotency_key having count(*) > 1
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'duplicate_idempotency_keys', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select p.id as payment_id, p.paid_on, p.created_at
    from public.payments p
    where p.school_id = p_school_id
      and (p.paid_on > ((now() at time zone 'Africa/Lusaka')::date + 1)
           or p.paid_on < date '1990-01-01')
    limit 200
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'impossible_payment_dates', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select pa.payment_id, p.amount as payment_amount, sum(pa.amount) as allocated
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.school_id = p_school_id and pa.reversed_at is null
    group by pa.payment_id, p.amount
    having sum(pa.amount) > p.amount
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'payment_over_allocated', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select pa.charge_id, c.amount as charge_amount, sum(pa.amount) as allocated
    from public.payment_allocations pa
    join public.charges c on c.id = pa.charge_id
    join public.payments p on p.id = pa.payment_id
    where pa.school_id = p_school_id and pa.reversed_at is null
      and p.status = 'completed'::public.payment_status
    group by pa.charge_id, c.amount
    having sum(pa.amount) > c.amount
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'charge_over_allocated', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select pa.id as allocation_id, pa.student_id as allocation_student_id,
           p.student_id as payment_student_id, c.student_id as charge_student_id
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    join public.charges c on c.id = pa.charge_id
    where pa.school_id = p_school_id
      and (pa.student_id is distinct from p.student_id
           or pa.student_id is distinct from c.student_id
           or p.student_id is distinct from c.student_id)
    limit 200
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'cross_student_allocation', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select pa.id as allocation_id, pa.school_id as allocation_school_id,
           p.school_id as payment_school_id, c.school_id as charge_school_id
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    join public.charges c on c.id = pa.charge_id
    where pa.school_id = p_school_id
      and (pa.school_id is distinct from p.school_id
           or pa.school_id is distinct from c.school_id)
    limit 200
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'cross_school_allocation', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tmp from (
    select pa.payment_id, sum(pa.amount) as active_allocated
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.school_id = p_school_id
      and pa.reversed_at is null
      and p.status = 'voided'::public.payment_status
    group by pa.payment_id
  ) x;
  if coalesce(jsonb_array_length(v_tmp), 0) > 0 then
    v_blocking := v_blocking || jsonb_build_array(jsonb_build_object(
      'code', 'voided_payment_active_allocations', 'severity', 'blocking', 'blocking', true, 'rows', v_tmp
    ));
  end if;

  select coalesce(sum((jsonb_array_length(coalesce(w->'rows', '[]'::jsonb)) > 0)::int), 0)
  into v_warning_count
  from jsonb_array_elements(v_warnings) as w;

  v_blocking_count := coalesce(jsonb_array_length(v_blocking), 0);

  return jsonb_build_object(
    'school_id', p_school_id,
    'school_count', v_school_count,
    'active_charges_count', v_active_charges,
    'completed_payments_count', v_completed_payments,
    'voided_payments_count', v_voided_payments,
    'total_active_charges', v_total_charges,
    'total_completed_payments', v_total_payments,
    'warnings', v_warnings,
    'blocking_issues', v_blocking,
    'warning_count', v_warning_count,
    'blocking_issue_count', v_blocking_count,
    'safe_to_backfill', v_blocking_count = 0
  );
end;
$$;

revoke all on function public.diagnose_finance_pre_allocation_for_school(uuid)
  from public, anon, authenticated;

create or replace function public.diagnose_finance_pre_allocation()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
begin
  if not (public.is_administrator() or public.can_manage_fees()) then
    raise exception 'You are not authorized to run finance diagnostics.';
  end if;
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  return public.diagnose_finance_pre_allocation_for_school(v_school_id);
end;
$$;

revoke all on function public.diagnose_finance_pre_allocation() from public, anon;
grant execute on function public.diagnose_finance_pre_allocation() to authenticated;

-- Invariant validation -----------------------------------------------------
create or replace function public.validate_payment_allocation_invariants_for_school(
  p_school_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_issues jsonb := '[]'::jsonb;
  v_blocking_count int := 0;
begin
  if p_school_id is null then
    raise exception 'school_id is required.';
  end if;

  -- Payment: active alloc <= amount
  select coalesce(jsonb_agg(jsonb_build_object(
    'invariant_name', 'payment_active_alloc_lte_amount',
    'school_id', p_school_id,
    'payment_id', x.payment_id,
    'expected', x.payment_amount,
    'actual', x.allocated,
    'severity', 'blocking',
    'blocking', true
  )), '[]'::jsonb)
  into v_issues
  from (
    select pa.payment_id, p.amount as payment_amount, sum(pa.amount) as allocated
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.school_id = p_school_id and pa.reversed_at is null
    group by pa.payment_id, p.amount
    having sum(pa.amount) > p.amount
  ) x;

  -- Voided: active alloc = 0
  select v_issues || coalesce(jsonb_agg(jsonb_build_object(
    'invariant_name', 'voided_payment_no_active_alloc',
    'school_id', p_school_id,
    'payment_id', x.payment_id,
    'expected', 0,
    'actual', x.allocated,
    'severity', 'blocking',
    'blocking', true
  )), '[]'::jsonb)
  into v_issues
  from (
    select pa.payment_id, sum(pa.amount) as allocated
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.school_id = p_school_id and pa.reversed_at is null
      and p.status = 'voided'::public.payment_status
    group by pa.payment_id
  ) x;

  -- Charge: active alloc <= amount
  select v_issues || coalesce(jsonb_agg(jsonb_build_object(
    'invariant_name', 'charge_active_alloc_lte_amount',
    'school_id', p_school_id,
    'charge_id', x.charge_id,
    'expected', x.charge_amount,
    'actual', x.allocated,
    'severity', 'blocking',
    'blocking', true
  )), '[]'::jsonb)
  into v_issues
  from (
    select pa.charge_id, c.amount as charge_amount, sum(pa.amount) as allocated
    from public.payment_allocations pa
    join public.charges c on c.id = pa.charge_id
    join public.payments p on p.id = pa.payment_id
    where pa.school_id = p_school_id and pa.reversed_at is null
      and p.status = 'completed'::public.payment_status
    group by pa.charge_id, c.amount
    having sum(pa.amount) > c.amount
  ) x;

  -- Cancelled/waived: active alloc = 0
  select v_issues || coalesce(jsonb_agg(jsonb_build_object(
    'invariant_name', 'cancelled_or_waived_no_active_alloc',
    'school_id', p_school_id,
    'charge_id', x.charge_id,
    'expected', 0,
    'actual', x.allocated,
    'severity', 'blocking',
    'blocking', true
  )), '[]'::jsonb)
  into v_issues
  from (
    select pa.charge_id, sum(pa.amount) as allocated
    from public.payment_allocations pa
    join public.charges c on c.id = pa.charge_id
    where pa.school_id = p_school_id and pa.reversed_at is null
      and c.status in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
    group by pa.charge_id
  ) x;

  -- Relationship mismatches
  select v_issues || coalesce(jsonb_agg(jsonb_build_object(
    'invariant_name', 'allocation_relationship_match',
    'school_id', p_school_id,
    'allocation_id', x.allocation_id,
    'student_id', x.allocation_student_id,
    'expected', 'matching school/student on payment and charge',
    'actual', 'mismatch',
    'severity', 'blocking',
    'blocking', true
  )), '[]'::jsonb)
  into v_issues
  from (
    select pa.id as allocation_id, pa.student_id as allocation_student_id
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    join public.charges c on c.id = pa.charge_id
    where pa.school_id = p_school_id
      and (
        pa.school_id is distinct from p.school_id
        or pa.school_id is distinct from c.school_id
        or pa.student_id is distinct from p.student_id
        or pa.student_id is distinct from c.student_id
      )
  ) x;

  -- Credit >= 0 per pupil
  select v_issues || coalesce(jsonb_agg(jsonb_build_object(
    'invariant_name', 'available_credit_non_negative',
    'school_id', p_school_id,
    'student_id', x.student_id,
    'expected', 0,
    'actual', x.credit,
    'severity', 'blocking',
    'blocking', true
  )), '[]'::jsonb)
  into v_issues
  from (
    select s.id as student_id,
           (coalesce(pay.total_paid, 0) - coalesce(alloc.total_alloc, 0)) as credit
    from public.students s
    left join lateral (
      select coalesce(sum(p.amount), 0) as total_paid from public.payments p
      where p.student_id = s.id and p.status = 'completed'::public.payment_status
    ) pay on true
    left join lateral (
      select coalesce(sum(pa.amount), 0) as total_alloc
      from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id
      where pa.student_id = s.id and pa.reversed_at is null
        and p.status = 'completed'::public.payment_status
    ) alloc on true
    where s.school_id = p_school_id
      and (coalesce(pay.total_paid, 0) - coalesce(alloc.total_alloc, 0)) < 0
  ) x;

  select count(*) into v_blocking_count
  from jsonb_array_elements(v_issues) i
  where coalesce((i->>'blocking')::boolean, false);

  return jsonb_build_object(
    'school_id', p_school_id,
    'issues', v_issues,
    'blocking_issue_count', v_blocking_count,
    'ok', v_blocking_count = 0
  );
end;
$$;

revoke all on function public.validate_payment_allocation_invariants_for_school(uuid)
  from public, anon, authenticated;

create or replace function public.validate_payment_allocation_invariants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
begin
  if not public.is_administrator() then
    raise exception 'Only an Administrator may validate payment allocation invariants.';
  end if;
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  return public.validate_payment_allocation_invariants_for_school(v_school_id);
end;
$$;

revoke all on function public.validate_payment_allocation_invariants() from public, anon;
grant execute on function public.validate_payment_allocation_invariants() to authenticated;
