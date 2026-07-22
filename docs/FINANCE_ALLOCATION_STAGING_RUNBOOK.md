# Finance Allocation Migration — Staging Verification Runbook

**Environment:** staging Supabase only  
**Goal:** Verify the complete Phase 2 payment-allocation migration process before production approval.

| Constraint | Status |
|---|---|
| Run against production | **Forbidden** |
| Activate production finance | **Forbidden** |
| Change production data | **Forbidden** |
| Deploy application | **Out of scope for this runbook** |

---

## Current baseline (pre-cutover)

| Signal | Expected value |
|---|---|
| Finance mode | **LEGACY** |
| Allocation system | Installed but **inactive** (after schema migrations) |
| Payment behaviour | Legacy overpayment restrictions remain active |
| Available credit in UI/summary | **0** until activation |

Admin visibility (after status migration):  
**Settings → Finance migration readiness** → `/dashboard/settings/finance-migration`

---

## Operator roles

| Role | Allowed on staging |
|---|---|
| Administrator (app) | View migration status UI; functional tests via UI |
| SQL editor / service role | Diagnostics, prepare, dry-run, execute backfill, validate, activate |
| Authenticated non-admin | Must **not** view migration status or run console RPCs |

Console RPCs (`prepare_*`, `run_payment_allocation_backfill`, `activate_payment_allocations`, school-scoped diagnose/validate helpers) are **revoked from `authenticated`**. Run them only in the Supabase SQL editor (or equivalent privileged session) on **staging**.

---

## Prerequisites

1. A **dedicated staging** Supabase project (or branch) with a recent copy of production-like data — **not** the live project.
2. App pointed at staging (`.env.local` staging URL/keys only).
3. Operator access to Supabase SQL editor for that staging project.
4. School UUID known:

```sql
select id, name from public.schools order by name;
-- Set once for the session:
-- \set school_id 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
```

5. Verification SQL helpers available:

- `supabase/diagnostics/finance_allocation_staging_verification.sql`
- `supabase/diagnostics/finance_pre_allocation_readonly.sql`

6. Readiness report template:

- `docs/FINANCE_ALLOCATION_PRODUCTION_READINESS_REPORT.md`

7. Phase 2.5 working log (step-by-step verification status):

- `docs/FINANCE_ALLOCATION_PHASE_2_5_VERIFICATION.md`

---

# PHASE 1 — STAGING BACKUP

**Do not skip.** Restore must be possible if staging backfill or activation misbehaves.

### 1.1 Required database backup

- [ ] Create a **full staging database backup** (Supabase Dashboard → Database → Backups, or `pg_dump` of the staging DB).
- [ ] Record backup id / filename / timestamp: ________________
- [ ] Confirm restore procedure is understood (who can restore, how long).

### 1.2 Schema version capture

Run section **A** of `finance_allocation_staging_verification.sql`, or:

```sql
select
  current_database() as database_name,
  version() as postgres_version,
  current_setting('server_version') as server_version;
```

Paste into the readiness report.

### 1.3 Migration version capture

```sql
select version, name, inserted_at
from supabase_migrations.schema_migrations
order by version;
```

Record the highest applied version **before** Phase 2 migrations: ________________

### 1.4 Current finance totals capture

Run section **B** of the verification helper (replace `:school_id`), or:

```sql
-- Replace with staging school UUID
with params as (
  select '<school-uuid>'::uuid as school_id
)
select
  (select count(*) from public.students s, params p where s.school_id = p.school_id)
    as total_students,
  (select count(*) from public.charges c, params p
    where c.school_id = p.school_id
      and c.status not in ('cancelled', 'waived'))
    as total_active_charges,
  (select count(*) from public.payments pay, params p
    where pay.school_id = p.school_id and pay.status = 'completed')
    as total_completed_payments,
  (select count(*) from public.payments pay, params p
    where pay.school_id = p.school_id and pay.status = 'voided')
    as total_voided_payments,
  (select coalesce(sum(pay.amount), 0) from public.payments pay, params p
    where pay.school_id = p.school_id and pay.status = 'completed')
    as total_payment_value,
  (select coalesce(sum(c.amount), 0) from public.charges c, params p
    where c.school_id = p.school_id
      and c.status not in ('cancelled', 'waived'))
    as total_charge_value,
  (
    select coalesce(sum(c.amount), 0) - coalesce(sum(pay.amount), 0)
    from params p
    left join public.charges c
      on c.school_id = p.school_id
     and c.status not in ('cancelled', 'waived')
    left join public.payments pay
      on pay.school_id = p.school_id and pay.status = 'completed'
  ) as naive_outstanding_note,
  (select count(*) from public.payments pay, params p
    where pay.school_id = p.school_id
      and pay.receipt_number is not null)
    as existing_receipts_count;
```

**Preferred outstanding total** (per-pupil legacy style, then sum) is in the helper script section **B** — use that for the report.

| Metric | Captured value |
|---|---|
| Total students | |
| Total active charges | |
| Total completed payments | |
| Total voided payments | |
| Total payment value (ZMW) | |
| Total charge value (ZMW) | |
| Current outstanding balance total (ZMW) | |
| Existing receipts count | |
| Capture timestamp | |

**Gate:** Phase 1 complete before any Phase 2 migration is applied.

---

# PHASE 2 — APPLY MIGRATIONS

Apply **only** on staging, in this exact order.

### Apply (inactive allocation system)

| Order | Migration | Purpose |
|---|---|---|
| 1 | `20260719150000_payment_allocations_schema.sql` | Schema, helpers, gates; finance still LEGACY |
| 2 | `20260719150010_payment_allocations_diagnostics.sql` | Diagnose + validate invariants |
| 3 | `20260719150100_payment_allocations_rpc_backfill.sql` | Controlled prepare / dry-run / execute backfill |
| 4 | `20260719150300_finance_allocation_migration_status.sql` | Admin status checker + `activated_by` column |

### Do **not** apply yet

| Migration | Why deferred |
|---|---|
| `20260719150200_payment_allocations_activation.sql` | Enables dual-mode payment RPCs and overpayment credit path. Apply only in **Phase 7 (staging)** after backfill + validation succeed. |

### How to apply

Use your normal staging migration path (Supabase CLI / dashboard migration history). Confirm each version appears in `supabase_migrations.schema_migrations`.

```sql
select version, name
from supabase_migrations.schema_migrations
where version like '2026071915%'
order by version;
```

Expected after Phase 2:

- `…150000`, `…150010`, `…150100`, `…150300` present  
- `…150200` **absent**

### Post-apply sanity

- [ ] `to_regclass('public.payment_allocations')` is not null  
- [ ] `select public.get_finance_allocation_migration_status();` as Administrator returns `finance_mode = legacy`  
- [ ] Recording a payment that would overpay still **rejects** (legacy behaviour)

**Gate:** Schema installed, inactive, LEGACY mode confirmed.

---

# PHASE 3 — DIAGNOSTICS

### Operator checklist

- [ ] Connected to **staging** only (verify project URL / database name).
- [ ] Phase 1 totals archived.
- [ ] Phase 2 migrations applied (without activation migration).

### Run diagnostics

```sql
select public.diagnose_finance_pre_allocation_for_school('<school-uuid>');
-- or, as an authenticated administrator for their school:
select public.diagnose_finance_pre_allocation();
```

Also run helper section **C** (pretty summary).

### Hard requirements

| Field | Required |
|---|---|
| `safe_to_backfill` | `true` |
| `blocking_issue_count` | `0` |

If either fails → **STOP**. Do not dry-run or execute backfill. Fix data, re-diagnose.

### Review warnings (non-blocking)

| Code | Meaning | Acceptable? |
|---|---|---|
| `pupils_payments_exceed_charges` | Historical advance / overpay candidates (payments > charges) | **Yes — expected** for schools that took advance fees under legacy rules. These become available credit after activation. Review counts; spot-check a sample. |
| `pupils_negative_legacy_balance` | Same family as excess payments (negative legacy balance) | **Yes** if it matches known advance payers. Investigate if unexpected pupils appear. |
| `pupils_current_year_vs_lifetime_mismatch` | Current-year UI balance ≠ lifetime net | **Usually acceptable** when prior-year charges/payments exist. Confirm this matches how the app scopes balances. |
| `partially_allocated_payments` | Payments already partially allocated | **Acceptable only** after a prior partial backfill on this staging DB. On a clean first run, investigate. |

### Blocking issues (never acceptable)

Fix before proceeding:

- `payment_student_school_mismatch` / `charge_student_school_mismatch`
- `duplicate_receipt_numbers` / `duplicate_idempotency_keys`
- `impossible_payment_dates`
- `payment_over_allocated` / `charge_over_allocated`
- `cross_student_allocation` / `cross_school_allocation`
- `voided_payment_active_allocations`

### Suspicious records review

- [ ] Sample 5–10 advance-payment candidates (payments ≫ charges).  
- [ ] Confirm no cross-school rows.  
- [ ] Confirm receipt numbers unique.  
- [ ] Record `warning_count` and notable codes in the readiness report.

Optional prepare step (records `diagnostics_ok_at` on the gate when safe):

```sql
select public.prepare_payment_allocation_backfill('<school-uuid>');
```

**Gate:** `safe_to_backfill = true` and `blocking_issue_count = 0`.

---

# PHASE 4 — DRY RUN BACKFILL

**Still no activation. Still staging only.**

```sql
select public.run_payment_allocation_backfill(
  '<school-uuid>'::uuid,
  true,   -- dry_run
  true    -- fail_fast
);
```

### Capture from RPC result

| Field | Value |
|---|---|
| `mode` | must be `dry_run` |
| `payments_seen` | |
| `payments_already_complete` | |
| `payments_needing_resume` | |
| `pupils_processed` / `pupils_failed` | |
| `allocations_created` | must be `0` |
| `failures` | must be `[]` |
| Blocking from nested `diagnostics` | must be `0` |

### Estimate allocations / credits (dry-run limitation)

The dry-run path **does not insert** rows and does **not** fully simulate allocation counts. Use helper section **D** for estimates:

- payments that would still need allocation work  
- estimated credit-bearing payments after oldest-first fill  
- current vs projected active allocation row counts  

| Estimate | Value |
|---|---|
| Payments processed (seen) | |
| Allocations that would be created (helper) | |
| Credits that would remain (helper) | |
| Blocking issues | `0` |
| Warnings (from diagnostics) | |

**Gate:** Dry-run completes without exception; no failures; diagnostics still safe.

---

# PHASE 5 — EXECUTE BACKFILL

**Run only after explicit staging approval** (operator + reviewer).

```sql
-- Optional: wall-clock
select clock_timestamp() as backfill_started_at;

select public.run_payment_allocation_backfill(
  '<school-uuid>'::uuid,
  false,  -- execute
  true    -- fail_fast
);

select clock_timestamp() as backfill_finished_at;
```

### Capture

| Field | Value |
|---|---|
| `mode` | `executed` |
| `payments_seen` | |
| `payments_complete` | |
| `payments_resumed` | |
| `allocations_created` | |
| `credit_remaining_payments` | |
| `pupils_processed` / `pupils_failed` | |
| Nested `validation.ok` | must be `true` |
| Execution duration | |

Helper section **E** captures allocation row counts and charges with allocations.

Idempotency check (safe to re-run):

```sql
select public.run_payment_allocation_backfill('<school-uuid>'::uuid, false, true);
```

Second run should show little/no new `allocations_created` (remaining amount already 0).

**Still do not activate.** Finance mode remains LEGACY; credit still hidden in summary until Phase 7.

**Gate:** Executed backfill succeeded; post-backfill validation inside RPC `ok = true`.

---

# PHASE 6 — VALIDATION

```sql
select public.validate_payment_allocation_invariants_for_school('<school-uuid>');
-- or:
select public.validate_payment_allocation_invariants();
```

### Require

| Field | Required |
|---|---|
| `ok` | `true` |
| `blocking_issue_count` | `0` |

### Verify (also covered by helper section **F**)

- [ ] Payment allocations ≤ payment amount  
- [ ] Charge allocations ≤ charge amount  
- [ ] No cross-student allocations  
- [ ] No cross-school allocations  
- [ ] Voided payments have no active allocations  
- [ ] Available credit calculations reconcile (`paid − allocated ≥ 0` per pupil)

Admin UI: refresh **Finance migration readiness** — backfill completed, validation ok/recorded, mode still **Legacy**.

**Gate:** Invariants pass with zero blocking issues.

---

# PHASE 7 — ACTIVATION TEST (STAGING ONLY)

### 7.1 Apply activation migration (staging)

Now apply:

```text
20260719150200_payment_allocations_activation.sql
```

Confirm it appears in migration history. Re-apply or ensure `20260719150300` status function still present (it replaces `activate_payment_allocations` to record `activated_by`).

### 7.2 Activate

```sql
select public.activate_payment_allocations('<school-uuid>'::uuid);
```

> Note: activation is **per school**, not per student.

### 7.3 Verify finance mode

```sql
select public.get_finance_allocation_migration_status();
```

| Before | After |
|---|---|
| `finance_mode`: `legacy` | `finance_mode`: `allocation_enabled` |
| UI: **Legacy** | UI: **Allocation Enabled** |
| `available_credit_readiness`: false | `true` |

- [ ] `activated_at` set  
- [ ] `activated_by_name` populated when run as a profile user (SQL editor may show null if no `auth.uid()`)  
- [ ] Overpayment path no longer hard-rejects when credit is allowed by activated RPCs  

**Never run this against production as part of this runbook.**

**Gate:** Staging shows **ALLOCATION_ENABLED**.

---

# PHASE 8 — FUNCTIONAL TESTING

Create **dedicated staging test pupils** (do not use real production identities if avoidable). Record admission numbers and payment/receipt ids.

Use Fees UI or RPCs on staging with allocation enabled.

### Test 1 — Normal payment

| Step | Value |
|---|---|
| Charge | 5000 |
| Payment | 5000 |
| Expected allocated | 5000 |
| Expected credit | 0 |

- [ ] Pass / Fail — notes: ________

### Test 2 — Advance payment

| Step | Value |
|---|---|
| Charge | 5000 |
| Payment | 7000 |
| Expected allocated | 5000 |
| Expected credit | 2000 |

- [ ] Pass / Fail — notes: ________

### Test 3 — Credit application

| Step | Value |
|---|---|
| Starting credit | 2000 |
| Outstanding | 3000 |
| Action | Apply credit |
| Expected credit | 0 |
| Expected outstanding | 1000 |

- [ ] Pass / Fail — notes: ________

### Test 4 — Payment void

| Step | Expected |
|---|---|
| Void payment | Allocations reversed (`reversed_at` set) |
| Balance | Restored appropriately |
| Credit | Recalculated (no active alloc from voided payment) |

- [ ] Pass / Fail — notes: ________

### Test 5 — Receipt

Verify receipt shows:

- [ ] Amount received  
- [ ] Amount allocated  
- [ ] Credit created (when applicable)  

### Test 6 — Reports

On fee balances / finance reports, verify:

- [ ] Gross payments  
- [ ] Allocated amounts  
- [ ] Credits  
- [ ] Outstanding balances  

**Gate:** All six functional scenarios pass on staging.

---

# PHASE 9 — FAILURE TESTING

Verify recovery on staging (separate from happy-path pupils where possible).

| Scenario | How to verify | Pass? |
|---|---|---|
| Interrupted backfill | Start execute, cancel/timeout if feasible; re-run `run_payment_allocation_backfill(..., false, true)` | resumes by remaining amount |
| Rerunning backfill | Second execute after success | little/no new allocations; still `ok` |
| Duplicate payment requests | Same idempotency key twice | no double charge / no double alloc |
| Invalid allocation attempt | Manual insert violating invariants (if tested) or over-allocate via bad path | rejected / invariants catch |
| Unauthorized activation | Call `activate_payment_allocations` as anon/authenticated browser role | denied (revoked) |
| Unauthorized status view | Non-admin opens `/dashboard/settings/finance-migration` | redirected / denied |

- [ ] Failure matrix complete  

**Gate:** Recovery and authorization behaviours acceptable.

---

# PHASE 10 — PRODUCTION READINESS REPORT

Fill `docs/FINANCE_ALLOCATION_PRODUCTION_READINESS_REPORT.md` using helper section **G**.

### Decision

| Verdict | Criteria |
|---|---|
| **READY** | Phases 1–9 complete; diagnostics safe; backfill + validation ok; functional + failure tests pass; warnings understood; risks documented |
| **NOT READY** | Any blocking issue, failed functional test, unclear warnings, or incomplete backup/restore story |

Include:

- Database version  
- Migration versions applied  
- Diagnostics result  
- Backfill result  
- Validation result  
- Functional test results  
- Known warnings  
- Known risks  
- Recommended production date  

### Production cutover (future — not this runbook)

Production cutover is a **separate** controlled change window. This runbook **must not**:

- deploy  
- activate production  
- modify live data  

---

## Quick reference — staging SQL order

```sql
-- Phase 3
select public.diagnose_finance_pre_allocation_for_school('<school-uuid>');
select public.prepare_payment_allocation_backfill('<school-uuid>');

-- Phase 4
select public.run_payment_allocation_backfill('<school-uuid>', true, true);

-- Phase 5 (after approval)
select public.run_payment_allocation_backfill('<school-uuid>', false, true);

-- Phase 6
select public.validate_payment_allocation_invariants_for_school('<school-uuid>');

-- Phase 7 (after applying 20260719150200 on staging only)
select public.activate_payment_allocations('<school-uuid>');
select public.get_finance_allocation_migration_status();
```

---

## Related files

| File | Role |
|---|---|
| `supabase/diagnostics/finance_allocation_staging_verification.sql` | Capture / estimate / validation helpers |
| `supabase/diagnostics/finance_pre_allocation_readonly.sql` | Thin diagnose wrapper |
| `supabase/tests/payment_allocations_hardening.sql` | Automated SQL suite (non-production) |
| `docs/FINANCE_ALLOCATION_PRODUCTION_READINESS_REPORT.md` | Phase 10 report template |
| `/dashboard/settings/finance-migration` | Admin read-only status UI |
