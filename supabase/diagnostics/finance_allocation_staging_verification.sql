-- =============================================================================
-- Finance Allocation Migration — STAGING verification helpers
-- =============================================================================
--
-- Companion to: docs/FINANCE_ALLOCATION_STAGING_RUNBOOK.md
--
-- SAFETY
--   • Run ONLY on a staging Supabase database.
--   • Do NOT run against production.
--   • This file does not activate allocations by default.
--   • Sections that call backfill/activate are clearly marked — run those
--     only when the runbook phase says so.
--
-- SETUP (Supabase SQL editor — recommended)
--   1. Paste your staging school UUID into set_config below.
--   2. Run that single statement first.
--   3. Run each SECTION block as needed (do not uncomment execute/activate
--      until the runbook says so).
--
-- psql alternative: same set_config pattern works in psql too.
-- =============================================================================

select set_config(
  'bfa.staging_school_id',
  '00000000-0000-0000-0000-000000000000', -- <<< STAGING SCHOOL UUID
  false
);

-- =============================================================================
-- SECTION A — Schema / migration version capture (Phase 1)
-- =============================================================================

select
  current_database() as database_name,
  version() as postgres_version,
  now() as captured_at;

select version, name, inserted_at
from supabase_migrations.schema_migrations
order by version;

select
  to_regclass('public.payment_allocations') is not null as allocation_schema_installed,
  to_regclass('public.finance_allocation_gates') is not null as gates_table_installed,
  to_regprocedure('public.diagnose_finance_pre_allocation()') is not null
    as diagnostics_available,
  to_regprocedure('public.run_payment_allocation_backfill(uuid,boolean,boolean)') is not null
    as backfill_rpc_available,
  to_regprocedure('public.activate_payment_allocations(uuid)') is not null
    as activate_rpc_available,
  to_regprocedure('public.get_finance_allocation_migration_status()') is not null
    as status_checker_available;

-- =============================================================================
-- SECTION B — Current finance totals capture (Phase 1)
-- Outstanding = sum over pupils of max(0, active_charges - completed_payments)
-- =============================================================================

with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
),
pupil_totals as (
  select
    s.id as student_id,
    coalesce((
      select sum(c.amount)
      from public.charges c
      where c.student_id = s.id
        and c.status not in (
          'cancelled'::public.charge_status,
          'waived'::public.charge_status
        )
    ), 0) as charge_value,
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.student_id = s.id
        and p.status = 'completed'::public.payment_status
    ), 0) as payment_value
  from public.students s
  join params p on p.school_id = s.school_id
)
select
  (select count(*) from public.students s join params p on p.school_id = s.school_id)
    as total_students,
  (select count(*) from public.charges c join params p on p.school_id = c.school_id
    where c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status))
    as total_active_charges,
  (select count(*) from public.payments pay join params p on p.school_id = pay.school_id
    where pay.status = 'completed'::public.payment_status)
    as total_completed_payments,
  (select count(*) from public.payments pay join params p on p.school_id = pay.school_id
    where pay.status = 'voided'::public.payment_status)
    as total_voided_payments,
  (select coalesce(sum(pay.amount), 0)
    from public.payments pay join params p on p.school_id = pay.school_id
    where pay.status = 'completed'::public.payment_status)
    as total_payment_value,
  (select coalesce(sum(c.amount), 0)
    from public.charges c join params p on p.school_id = c.school_id
    where c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status))
    as total_charge_value,
  (select coalesce(sum(greatest(pt.charge_value - pt.payment_value, 0)), 0)
    from pupil_totals pt)
    as current_outstanding_balance_total,
  (select count(*) from public.payments pay join params p on p.school_id = pay.school_id
    where pay.receipt_number is not null)
    as existing_receipts_count,
  now() as captured_at;

-- Advance-payment / historical credit candidates (review sample)
with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
)
select
  s.admission_number,
  s.id as student_id,
  coalesce(pay.total_paid, 0) as total_paid,
  coalesce(chg.total_charged, 0) as total_charged,
  (coalesce(pay.total_paid, 0) - coalesce(chg.total_charged, 0)) as excess
from public.students s
join params p on p.school_id = s.school_id
left join lateral (
  select coalesce(sum(pay.amount), 0) as total_paid
  from public.payments pay
  where pay.student_id = s.id and pay.status = 'completed'::public.payment_status
) pay on true
left join lateral (
  select coalesce(sum(c.amount), 0) as total_charged
  from public.charges c
  where c.student_id = s.id
    and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
) chg on true
where coalesce(pay.total_paid, 0) > coalesce(chg.total_charged, 0)
order by excess desc
limit 50;

-- =============================================================================
-- SECTION C — Diagnostics summary (Phase 3)
-- Requires migrations 150000 + 150010
-- =============================================================================

select public.diagnose_finance_pre_allocation_for_school(current_setting('bfa.staging_school_id')::uuid)
  as full_diagnostics;

select
  (d->>'safe_to_backfill')::boolean as safe_to_backfill,
  (d->>'blocking_issue_count')::int as blocking_issue_count,
  (d->>'warning_count')::int as warning_count,
  (d->>'completed_payments_count')::bigint as completed_payments_count,
  (d->>'voided_payments_count')::bigint as voided_payments_count,
  (d->>'active_charges_count')::bigint as active_charges_count,
  (d->>'total_completed_payments')::numeric as total_completed_payments,
  (d->>'total_active_charges')::numeric as total_active_charges
from (
  select public.diagnose_finance_pre_allocation_for_school(current_setting('bfa.staging_school_id')::uuid) as d
) x;

-- Warning codes with non-empty rows
select
  w->>'code' as warning_code,
  w->>'severity' as severity,
  jsonb_array_length(coalesce(w->'rows', '[]'::jsonb)) as row_count
from (
  select public.diagnose_finance_pre_allocation_for_school(current_setting('bfa.staging_school_id')::uuid) as d
) x
cross join lateral jsonb_array_elements(coalesce(d->'warnings', '[]'::jsonb)) as w
where jsonb_array_length(coalesce(w->'rows', '[]'::jsonb)) > 0
order by warning_code;

-- Blocking issue codes (must be empty to proceed)
select
  b->>'code' as blocking_code,
  jsonb_array_length(coalesce(b->'rows', '[]'::jsonb)) as row_count,
  b->'rows' as sample_rows
from (
  select public.diagnose_finance_pre_allocation_for_school(current_setting('bfa.staging_school_id')::uuid) as d
) x
cross join lateral jsonb_array_elements(coalesce(d->'blocking_issues', '[]'::jsonb)) as b
order by blocking_code;

-- =============================================================================
-- SECTION D — Dry-run backfill + estimates (Phase 4)
-- Uncomment to execute. Does not write allocation rows.
-- =============================================================================

/*
select public.run_payment_allocation_backfill(
  current_setting('bfa.staging_school_id')::uuid,
  true,  -- dry_run
  true   -- fail_fast
) as dry_run_result;
*/

-- Estimate work remaining (read-only; complements dry-run RPC)
with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
),
payment_remaining as (
  select
    p.id as payment_id,
    p.student_id,
    p.amount,
    public.payment_active_allocated(p.id) as already_allocated,
    (p.amount - public.payment_active_allocated(p.id))::numeric(12, 2) as remaining
  from public.payments p
  join params x on x.school_id = p.school_id
  where p.status = 'completed'::public.payment_status
)
select
  count(*) filter (where remaining > 0) as payments_needing_allocation,
  count(*) filter (where remaining = 0) as payments_already_fully_allocated,
  count(*) filter (where already_allocated > 0 and remaining > 0) as payments_partially_allocated,
  coalesce(sum(remaining) filter (where remaining > 0), 0) as total_unallocated_payment_value,
  (
    select count(*)
    from public.payment_allocations pa
    join params x on x.school_id = pa.school_id
    where pa.reversed_at is null
  ) as current_active_allocation_rows
from payment_remaining;

-- Per-pupil projected credit if remaining payment value cannot fill open charges
-- (heuristic: credit ≈ max(0, unallocated_payments - open_charge_capacity))
with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
),
pupils as (
  select s.id as student_id
  from public.students s
  join params p on p.school_id = s.school_id
),
open_capacity as (
  select
    c.student_id,
    coalesce(sum(
      greatest(
        c.amount - coalesce((
          select sum(pa.amount)
          from public.payment_allocations pa
          join public.payments pay on pay.id = pa.payment_id
          where pa.charge_id = c.id
            and pa.reversed_at is null
            and pay.status = 'completed'::public.payment_status
        ), 0),
        0
      )
    ), 0) as open_charge_capacity
  from public.charges c
  join params p on p.school_id = c.school_id
  where c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
  group by c.student_id
),
unallocated_pay as (
  select
    pay.student_id,
    coalesce(sum(pay.amount - public.payment_active_allocated(pay.id)), 0) as unallocated
  from public.payments pay
  join params p on p.school_id = pay.school_id
  where pay.status = 'completed'::public.payment_status
  group by pay.student_id
)
select
  count(*) filter (
    where coalesce(u.unallocated, 0) > coalesce(o.open_charge_capacity, 0)
  ) as pupils_projected_with_credit,
  coalesce(sum(greatest(
    coalesce(u.unallocated, 0) - coalesce(o.open_charge_capacity, 0),
    0
  )), 0) as projected_total_available_credit
from pupils s
left join open_capacity o on o.student_id = s.student_id
left join unallocated_pay u on u.student_id = s.student_id;

-- =============================================================================
-- SECTION D2 — Dry-run review report (Phase 2.5 Step 6) — STOP after this
-- Paste into docs/FINANCE_ALLOCATION_PHASE_2_5_VERIFICATION.md
-- =============================================================================

with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
),
diag as (
  select public.diagnose_finance_pre_allocation_for_school(
    current_setting('bfa.staging_school_id')::uuid
  ) as d
),
payment_remaining as (
  select
    p.id,
    p.student_id,
    (p.amount - public.payment_active_allocated(p.id))::numeric(12, 2) as remaining
  from public.payments p
  join params x on x.school_id = p.school_id
  where p.status = 'completed'::public.payment_status
),
open_capacity as (
  select
    c.student_id,
    coalesce(sum(
      greatest(
        c.amount - coalesce((
          select sum(pa.amount)
          from public.payment_allocations pa
          join public.payments pay on pay.id = pa.payment_id
          where pa.charge_id = c.id
            and pa.reversed_at is null
            and pay.status = 'completed'::public.payment_status
        ), 0),
        0
      )
    ), 0) as open_charge_capacity
  from public.charges c
  join params p on p.school_id = c.school_id
  where c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
  group by c.student_id
),
unallocated_pay as (
  select
    pay.student_id,
    coalesce(sum(pay.amount - public.payment_active_allocated(pay.id)), 0) as unallocated
  from public.payments pay
  join params p on p.school_id = pay.school_id
  where pay.status = 'completed'::public.payment_status
  group by pay.student_id
),
credit_pupils as (
  select
    s.id as student_id,
    greatest(
      coalesce(u.unallocated, 0) - coalesce(o.open_charge_capacity, 0),
      0
    ) as projected_credit
  from public.students s
  join params p on p.school_id = s.school_id
  left join open_capacity o on o.student_id = s.id
  left join unallocated_pay u on u.student_id = s.id
)
select
  (select (d->>'completed_payments_count')::bigint from diag) as total_payments_examined,
  (select (d->>'active_charges_count')::bigint from diag) as total_charges_examined,
  (select count(*) from payment_remaining where remaining > 0)
    as payments_requiring_allocations,
  (select count(*) from payment_remaining where remaining > 0)
    as expected_allocation_work_units_min,
  (select coalesce(sum(projected_credit), 0) from credit_pupils where projected_credit > 0)
    as expected_credit_amount,
  (select count(*) from credit_pupils where projected_credit > 0)
    as students_receiving_credit,
  (select (d->>'warning_count')::int from diag) as students_or_groups_with_warnings,
  (select (d->>'blocking_issue_count')::int from diag) as blocking_issues,
  (select (d->>'safe_to_backfill')::boolean from diag) as safe_to_backfill,
  now() as review_report_captured_at;

-- Immutability check after dry-run (re-run after Step 5; totals must match Step 1)
with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
)
select
  coalesce(sum(pay.amount), 0) as total_completed_payment_amount,
  coalesce((
    select sum(c.amount) from public.charges c
    join params p on p.school_id = c.school_id
    where c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status)
  ), 0) as total_active_charge_amount,
  count(*) as completed_payment_rows
from public.payments pay
join params p on p.school_id = pay.school_id
where pay.status = 'completed'::public.payment_status;

-- =============================================================================
-- SECTION E — Execute backfill capture (Phase 5) — STAGING APPROVAL REQUIRED
-- =============================================================================

/*
select clock_timestamp() as backfill_started_at;

select public.run_payment_allocation_backfill(
  current_setting('bfa.staging_school_id')::uuid,
  false, -- execute
  true
) as execute_result;

select clock_timestamp() as backfill_finished_at;
*/

with params as (
  select current_setting('bfa.staging_school_id')::uuid as school_id
)
select
  count(*) filter (where pa.reversed_at is null) as active_allocation_rows,
  count(*) as all_allocation_rows_including_reversed,
  count(distinct pa.payment_id) filter (where pa.reversed_at is null)
    as payments_with_active_allocations,
  count(distinct pa.charge_id) filter (where pa.reversed_at is null)
    as charges_with_active_allocations,
  coalesce(sum(pa.amount) filter (where pa.reversed_at is null), 0)
    as total_active_allocated_value
from public.payment_allocations pa
join params p on p.school_id = pa.school_id;

select school_id, backfill_completed_at, invariants_ok_at, activated_at,
       last_backfill, updated_at
from public.finance_allocation_gates
where school_id = current_setting('bfa.staging_school_id')::uuid;

-- =============================================================================
-- SECTION F — Validation checklist (Phase 6)
-- =============================================================================

select public.validate_payment_allocation_invariants_for_school(current_setting('bfa.staging_school_id')::uuid)
  as validation_result;

-- Explicit invariant spot-checks (should all return 0 rows)
with params as (select current_setting('bfa.staging_school_id')::uuid as school_id)
select 'payment_over_allocated' as check_name, count(*)::int as bad_rows
from (
  select pa.payment_id
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  join params x on x.school_id = pa.school_id
  where pa.reversed_at is null
  group by pa.payment_id, p.amount
  having sum(pa.amount) > p.amount
) q
union all
select 'charge_over_allocated', count(*)::int
from (
  select pa.charge_id
  from public.payment_allocations pa
  join public.charges c on c.id = pa.charge_id
  join public.payments p on p.id = pa.payment_id
  join params x on x.school_id = pa.school_id
  where pa.reversed_at is null
    and p.status = 'completed'::public.payment_status
  group by pa.charge_id, c.amount
  having sum(pa.amount) > c.amount
) q
union all
select 'cross_student_allocation', count(*)::int
from public.payment_allocations pa
join public.payments p on p.id = pa.payment_id
join public.charges c on c.id = pa.charge_id
join params x on x.school_id = pa.school_id
where pa.student_id is distinct from p.student_id
   or pa.student_id is distinct from c.student_id
union all
select 'cross_school_allocation', count(*)::int
from public.payment_allocations pa
join public.payments p on p.id = pa.payment_id
join public.charges c on c.id = pa.charge_id
join params x on x.school_id = pa.school_id
where pa.school_id is distinct from p.school_id
   or pa.school_id is distinct from c.school_id
union all
select 'voided_with_active_alloc', count(*)::int
from public.payment_allocations pa
join public.payments p on p.id = pa.payment_id
join params x on x.school_id = pa.school_id
where pa.reversed_at is null
  and p.status = 'voided'::public.payment_status
union all
select 'negative_available_credit', count(*)::int
from (
  select s.id
  from public.students s
  join params x on x.school_id = s.school_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as total_paid
    from public.payments p
    where p.student_id = s.id and p.status = 'completed'::public.payment_status
  ) pay on true
  left join lateral (
    select coalesce(sum(pa.amount), 0) as total_alloc
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.student_id = s.id
      and pa.reversed_at is null
      and p.status = 'completed'::public.payment_status
  ) alloc on true
  where (coalesce(pay.total_paid, 0) - coalesce(alloc.total_alloc, 0)) < 0
) q;

-- =============================================================================
-- SECTION G — Status / readiness snapshot (Phase 7 / 10)
-- Requires migration 150300. Call as Administrator for auth.uid() path,
-- or use SQL editor after activation for gate columns.
-- =============================================================================

/*
-- Phase 7 only (after applying 20260719150200 on STAGING):
select public.activate_payment_allocations(current_setting('bfa.staging_school_id')::uuid);
*/

select
  g.school_id,
  case when g.activated_at is null then 'LEGACY' else 'ALLOCATION_ENABLED' end
    as finance_mode,
  g.backfill_completed_at,
  g.invariants_ok_at,
  g.diagnostics_ok_at,
  g.activated_at,
  g.activated_by,
  g.updated_at,
  g.last_backfill,
  g.last_validation
from public.finance_allocation_gates g
where g.school_id = current_setting('bfa.staging_school_id')::uuid;

-- When signed in as administrator via PostgREST / app:
-- select public.get_finance_allocation_migration_status();

-- =============================================================================
-- SECTION H — Failure / auth smoke notes (Phase 9)
-- =============================================================================
-- Expect: run_payment_allocation_backfill / activate_payment_allocations
--         are NOT executable by anon/authenticated browser clients.
-- Expect: get_finance_allocation_migration_status raises for non-administrators.
-- Re-run execute backfill after success to confirm idempotent resume.
-- Document results in FINANCE_ALLOCATION_PRODUCTION_READINESS_REPORT.md
