# Finance Allocation Migration — Production Readiness Report

**Fill this only after completing the staging runbook**  
(`docs/FINANCE_ALLOCATION_STAGING_RUNBOOK.md`).

| Field | Value |
|---|---|
| Report date | |
| Staging project / database | |
| Operator | |
| Reviewer | |
| School id (staging) | |
| School name | |

---

## Migration readiness

### READY / NOT READY

**Decision:** ☐ READY ☐ NOT READY

**Rationale (1–3 sentences):**

>

---

## Environment capture

| Item | Value |
|---|---|
| Database name | |
| Postgres version | |
| Backup id / timestamp (Phase 1) | |
| Highest migration before Phase 2 | |
| Migrations applied for this exercise | |

### Migration versions applied (tick)

- [ ] `20260719150000_payment_allocations_schema`
- [ ] `20260719150010_payment_allocations_diagnostics`
- [ ] `20260719150100_payment_allocations_rpc_backfill`
- [ ] `20260719150300_finance_allocation_migration_status`
- [ ] `20260719150200_payment_allocations_activation` (**staging activation test only**)

---

## Phase 1 — Pre-migration finance totals

| Metric | Value |
|---|---|
| Total students | |
| Total active charges | |
| Total completed payments | |
| Total voided payments | |
| Total payment value (ZMW) | |
| Total charge value (ZMW) | |
| Outstanding balance total (ZMW) | |
| Existing receipts count | |
| Captured at | |

---

## Phase 3 — Diagnostics

| Field | Value |
|---|---|
| `safe_to_backfill` | |
| `blocking_issue_count` | |
| `warning_count` | |
| Result JSON archived? | ☐ Yes |

### Known warnings (list codes + brief note)

| Code | Count / sample | Acceptable? | Notes |
|---|---|---|---|
| | | ☐ Yes ☐ No | |
| | | ☐ Yes ☐ No | |

---

## Phase 4 — Dry-run backfill

| Field | Value |
|---|---|
| `payments_seen` | |
| Helper: allocations that would be created | |
| Helper: credit-bearing payments estimate | |
| Failures | |
| Dry-run approved by | |

---

## Phase 5 — Execute backfill

| Field | Value |
|---|---|
| `allocations_created` | |
| `payments_seen` | |
| `payments_complete` / `payments_resumed` | |
| `credit_remaining_payments` | |
| Charges with active allocations | |
| Execution duration | |
| Re-run idempotent? | ☐ Yes ☐ No |

---

## Phase 6 — Validation

| Field | Value |
|---|---|
| `ok` | |
| `blocking_issue_count` | |
| Payment alloc ≤ payment | ☐ Pass |
| Charge alloc ≤ charge | ☐ Pass |
| No cross-student | ☐ Pass |
| No cross-school | ☐ Pass |
| Voided have no active alloc | ☐ Pass |
| Credit reconciles (≥ 0) | ☐ Pass |

---

## Phase 7 — Staging activation

| Field | Value |
|---|---|
| Finance mode before | LEGACY |
| Finance mode after | ALLOCATION_ENABLED |
| `activated_at` | |
| `activated_by` / name | |
| Admin UI confirms Allocation Enabled | ☐ Yes |

---

## Phase 8 — Functional tests

| Test | Result | Notes |
|---|---|---|
| 1 Normal payment (5000/5000 → alloc 5000, credit 0) | ☐ Pass ☐ Fail | |
| 2 Advance payment (7000 on 5000 → alloc 5000, credit 2000) | ☐ Pass ☐ Fail | |
| 3 Credit application (2000 on 3000 → credit 0, outstanding 1000) | ☐ Pass ☐ Fail | |
| 4 Payment void (alloc reversed, balance restored) | ☐ Pass ☐ Fail | |
| 5 Receipt (received / allocated / credit) | ☐ Pass ☐ Fail | |
| 6 Reports (gross / allocated / credits / outstanding) | ☐ Pass ☐ Fail | |

---

## Phase 9 — Failure testing

| Scenario | Result | Notes |
|---|---|---|
| Interrupted backfill recovery | ☐ Pass ☐ Fail | |
| Rerun backfill | ☐ Pass ☐ Fail | |
| Duplicate payment requests | ☐ Pass ☐ Fail | |
| Invalid allocation attempt | ☐ Pass ☐ Fail | |
| Unauthorized activation | ☐ Pass ☐ Fail | |
| Unauthorized status view | ☐ Pass ☐ Fail | |

---

## Known risks

| Risk | Severity | Mitigation |
|---|---|---|
| | | |
| | | |

---

## Recommended production date

| Field | Value |
|---|---|
| Recommended production window | |
| Preconditions still open | |
| App deploy coordination | Separate change — not approved by this report alone |
| Production activation | **Not performed** as part of staging verification |

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Operator | | | |
| Reviewer | | | |
| Product / school owner | | | |

---

**Reminder:** This report authorizes *readiness*, not automatic production cutover. Production backup, migration apply, backfill, validation, activation, and deploy remain a separate controlled procedure.
