# PHASE 2.5 — Staging Finance Allocation Migration Verification

**System:** Blessed Faith Academy School Management System  
**Exercise date:** 2026-07-19  
**Scope:** Staging verification only

---

## IMPORTANT RULES (enforced)

| Action | Status |
|---|---|
| Deploy | **Not done** |
| Activate production finance | **Not done** |
| Run production migrations | **Not done** |
| Modify production data | **Not done** |
| Execute backfill on production | **Not done** |
| Enable allocation mode in production | **Not done** |
| Change payment behaviour in production | **Not done** |

---

## Environment gate (blocking)

| Check | Result |
|---|---|
| Dedicated staging Supabase project configured for this exercise | **NO — not confirmed** |
| `.env.local` labeled / documented as staging-only | **NO** |
| Separate from production per `docs/OPERATIONS.md` | **Unverified** |
| Operator explicit confirmation: “this project ref is staging” | **Missing** |

**Decision:** Database Steps 1–10 against the currently configured Supabase project are **STOPPED**.

Reason: Phase 2.5 requires a **staging** database. The local app env points at a single Supabase project with no staging designation. Per project operations guidance, staging must be a **separate** Supabase project. Running migrations, diagnostics that write gate timestamps, backfill, or activation against an unverified project would risk production.

### What is allowed without a staging project

- Repo verification (`lint` / `test` / `build` / `cf:build`)
- Documentation / checklist / report templates
- SQL helper scripts prepared for later staging SQL Editor use

### What is required to unblock Steps 1–10

1. Create or identify a **staging** Supabase project (not production).
2. Confirm in writing: project name/ref is staging.
3. Point a staging-only env (e.g. `.env.staging.local`) at that project — do not reuse production keys.
4. Restore/copy schema (and optional anonymised data) as needed.
5. Re-run this Phase 2.5 checklist on that project only.

---

## Declared current architecture (repo / design state)

| Signal | Declared value | Live staging verified? |
|---|---|---|
| Finance architecture | LEGACY MODE | No |
| `payment_allocations` etc. | Implemented but inactive | Code + migrations in repo only |
| Schema tools | READY (in repo) | Not applied on confirmed staging |
| Diagnostics tools | READY (in repo) | Not verified on staging |
| Backfill tools | READY (in repo) | Not verified on staging |
| Activation | NOT ACTIVE | Correct for production; staging not exercised |

---

## Migration order (to apply on staging only)

| Order | File | Purpose | Apply in Phase 2.5 Steps 1–6? |
|---|---|---|---|
| 1 | `20260719150000_payment_allocations_schema.sql` | Allocation schema, constraints, RLS, helpers, gate | Yes (Step 2) |
| 2 | `20260719150010_payment_allocations_diagnostics.sql` | Diagnostics, invariants, readiness | Yes (Step 2) |
| 3 | `20260719150100_payment_allocations_rpc_backfill.sql` | Controlled backfill RPCs (no auto-run) | Yes (Step 2) |
| 4 | `20260719150300_finance_allocation_migration_status.sql` | Admin migration status visibility | Yes (Step 2) |
| — | `20260719150200_payment_allocations_activation.sql` | Dual-mode payment RPCs + activation | **NO until Step 8** |

---

## STEP 1 — Pre-migration snapshot

**Status:** ☐ Not run on staging (blocked)

Use `supabase/diagnostics/finance_allocation_staging_verification.sql` **Section B** on the staging SQL Editor.

| Metric | Value |
|---|---|
| Students count | _pending staging_ |
| Active charges count | _pending staging_ |
| Completed payments count | _pending staging_ |
| Voided payments count | _pending staging_ |
| Total active charges amount | _pending staging_ |
| Total completed payments amount | _pending staging_ |
| Total outstanding balance | _pending staging_ |
| Receipt count | _pending staging_ |
| Captured at | _pending staging_ |

Snapshot SQL is read-only. Do not modify data.

---

## STEP 2 — Apply staging migrations

**Status:** ☐ Not run (blocked)

Apply in order on staging only: `150000` → `150010` → `150100` → `150300`.

| Check | Result |
|---|---|
| Migrations succeed | _pending_ |
| No errors | _pending_ |
| No unexpected schema changes | _pending_ |
| No existing finance data changed | _pending_ (compare Step 1 totals) |

Confirm versions:

```sql
select version, name
from supabase_migrations.schema_migrations
where version like '2026071915%'
order by version;
```

Expected: `150000`, `150010`, `150100`, `150300` present; **`150200` absent**.

---

## STEP 3 — Check migration status

**Status:** ☐ Not run (blocked)

```sql
select public.get_finance_allocation_migration_status();
```

| Expected | Observed |
|---|---|
| Finance mode: LEGACY | _pending_ |
| Schema: READY / installed | _pending_ |
| Diagnostics: AVAILABLE | _pending_ |
| Backfill: NOT STARTED | _pending_ |
| Validation: NOT PASSED / not_run | _pending_ |
| Activation: NOT ACTIVE | _pending_ |

Also available in app (staging admin): `/dashboard/settings/finance-migration`

---

## STEP 4 — Run finance diagnostics

**Status:** ☐ Not run (blocked)

```sql
select public.diagnose_finance_pre_allocation();
-- or privileged:
select public.diagnose_finance_pre_allocation_for_school('<school-id>');
```

| Field | Value |
|---|---|
| `blocking_issue_count` | _pending_ |
| `warning_count` | _pending_ |
| `safe_to_backfill` | _pending_ |

**Hard stop if** `blocking_issue_count > 0`.

Do not automatically fix anything.

---

## STEP 5 — Backfill dry run

**Status:** ☐ Not run (blocked) — do not execute real backfill

```sql
select public.run_payment_allocation_backfill(
  '<school-id>'::uuid,
  true,  -- dry_run
  true   -- fail_fast
);
```

Plus estimate helper: verification SQL **Section D**.

| Check | Expected |
|---|---|
| Payment amounts unchanged | Yes |
| Charge amounts unchanged | Yes |
| Receipt numbers unchanged | Yes |
| Historical transactions not edited | Yes (`allocations_created = 0`) |

---

## STEP 6 — Dry-run review report

**Status:** ☐ Not created from live staging (blocked)

Fill from Step 5 + Section D:

| Item | Value |
|---|---|
| Total payments examined | |
| Total charges examined | |
| Expected allocation count | |
| Expected credit amount | |
| Students receiving credit | |
| Students with warnings | |
| Blocking issues | |

**STOP HERE until reviewed and approved.**

---

## STEP 7 — Execute backfill + validate (after approval only)

**Status:** ☐ Not run (blocked; also awaiting Step 6 approval)

```sql
select public.run_payment_allocation_backfill('<school-id>'::uuid, false, true);
select public.validate_payment_allocation_invariants();
```

Expected: `blocking_issue_count = 0` / `ok = true`.

---

## STEP 8 — Staging activation test

**Status:** ☐ Not run (blocked)

Only after Step 7 validation:

1. Apply `20260719150200_payment_allocations_activation.sql` on **staging**.
2. `select public.activate_payment_allocations('<school-id>');`
3. Confirm LEGACY → ALLOCATION_ENABLED.

---

## STEP 9 — Functional testing

**Status:** ☐ Not run (blocked)

| Test | Expected | Result |
|---|---|---|
| 1 Normal payment 5000/5000 | Alloc 5000, credit 0, outstanding 0 | |
| 2 Advance 7000 on 5000 | Alloc 5000, credit 2000, outstanding 0 | |
| 3 Apply credit 2000 on 3000 outstanding | Credit 0, outstanding 1000 | |
| 4 Void | Status VOIDED, allocations reversed, outstanding restored | |
| 5 Receipt | Received / allocated / credit / balance; receipt # unchanged | |

---

## STEP 10 — Failure testing

**Status:** ☐ Not run (blocked)

| Scenario | Result |
|---|---|
| Rerun backfill does not duplicate | |
| Interrupted backfill can continue | |
| Duplicate payment requests | |
| Unauthorized activation denied | |
| Unauthorized privileged ops denied | |
| Invalid allocations rejected | |

---

# FINAL REPORT

## 1. Migration results

**NOT EXECUTED** — staging project not confirmed. Repo migrations present and ordered correctly for staging apply.

## 2. Snapshot before migration

**NOT CAPTURED** on a confirmed staging database.

## 3. Migration status output

**NOT RUN.**

## 4. Diagnostic output

**NOT RUN.**

## 5. Blocking issues

**UNKNOWN** (diagnostics not run on staging).

## 6. Warnings

**UNKNOWN** (diagnostics not run on staging).

## 7. Dry-run backfill results

**NOT RUN.**

## 8. Actual backfill results

**NOT RUN** (correct — requires Step 6 approval after dry-run).

## 9. Validation results

**NOT RUN.**

## 10. Activation results

**NOT RUN** (correct for production; staging also not activated).

## 11. Functional test results

**NOT RUN.**

## 12. Security test results

**Repo-level only:** unit tests assert non-administrators cannot view migration status; console RPCs are revoked from `authenticated` in migrations. Live staging auth matrix not executed.

## 13. Remaining risks

| Risk | Severity | Notes |
|---|---|---|
| No confirmed staging Supabase project | **High** | Blocks all DB verification |
| Accidental use of production keys for “staging” steps | **Critical** | Mitigated by this stop |
| Historical advance payments become credit after activation | Medium | Expected; must review warning samples on staging |
| Dry-run RPC does not fully simulate allocation inserts | Low | Use Section D estimates |
| Production cutover without staging pass | **Critical** | Must not proceed |

## 14. Production readiness recommendation

### NOT READY

Staging verification has **not passed**. Do **not** claim production readiness. Do **not** deploy, activate production, or run production backfill.

**Next action:** Provide a confirmed staging Supabase project (URL/ref + school UUID + SQL Editor access), then re-run Steps 1–6 and stop for dry-run review before any execute/activate.

---

## Repo / app verification (executed this session)

| Command | Result |
|---|---|
| `npm run lint` | Pass (0 errors; 4 pre-existing warnings) |
| `npm test` | Pass — 84 tests |
| `npm run build` | Pass |
| `npm run cf:build` | Pass |

---

## Operator quick start (when staging is ready)

1. Open **staging** Supabase SQL Editor (verify project name).
2. Set school id in `supabase/diagnostics/finance_allocation_staging_verification.sql`.
3. Follow Steps 1–6 in this document / `docs/FINANCE_ALLOCATION_STAGING_RUNBOOK.md`.
4. Paste outputs into this file.
5. Stop after Step 6 for human approval before Step 7+.
