# Current finance system state (pre-production)

**Report date:** 2026-07-22  
**Purpose:** Determine actual live state before any further finance work.  
**Actions taken for this report:** read-only probes only. No backfill, activation, deploy, or data changes.

---

## Environment identity

| Field | Value |
|---|---|
| Environment role | **PRE-PRODUCTION** (approved; project name need not contain “staging”) |
| Supabase project name (operator-confirmed) | `blessed-faith-academy` |
| Project reference (from configured URL host) | `qaczvlbgsxcrdcdgsfpo` |
| Database host (no credentials) | `qaczvlbgsxcrdcdgsfpo.supabase.co` |
| Cloudflare application | https://bfa-sms-staging.nasalifya007.workers.dev/ |
| School | Blessed Faith Academy |
| School UUID | `516977ed-8612-4e27-addc-cdb5cdb72505` |
| App git HEAD (local / origin) | `7338143` — Phase 2 allocations, password reset, profile history |

---

## 1. Current finance mode

### **ALLOCATION_ENABLED**

Evidence from `public.finance_allocation_gates`:

| Column | Value |
|---|---|
| `activated_at` | `2026-07-22T13:13:23.278729+00:00` |
| `backfill_completed_at` | `2026-07-22T13:10:56.418661+00:00` |
| `invariants_ok_at` | `2026-07-22T13:13:23.278729+00:00` |
| `last_validation.ok` | `true` |
| `activated_by` | `null` (likely activated from SQL editor without `auth.uid()`) |

---

## 2. Has payment allocation activation already occurred?

### **Yes**

Gate `activated_at` is set for school `516977ed-8612-4e27-addc-cdb5cdb72505`.

**Do not re-run** `activate_payment_allocations`.  
**Do not** attempt to force LEGACY.

---

## 3. Has payment allocation backfill already been executed?

### **Yes**

Evidence:

- `backfill_completed_at` set  
- `last_backfill` recorded (`payments_seen: 0`, `pupils_processed: 21`, `allocations_created: 0`)  
- `finance_event_audits` contains `historical_backfill` events (2 rows)  

Note: backfill ran against **zero completed payments**, so **0** `payment_allocations` rows is expected and consistent.

**Do not repeat** the real backfill unless a future controlled re-run is explicitly planned after new historical payments are imported.

---

## 4. Has activation migration `20260719150200` been applied?

### **Yes (inferred from live objects / RPCs)**

There is no `supabase_migrations.schema_migrations` table on this project (migrations were applied via SQL Editor), so version history is object-based.

Evidence activation migration (or equivalent) is present:

- `activate_payment_allocations` RPC exists (probe: requires `school_id`)  
- `apply_available_credit` RPC exists (probe: authorization error, not “function missing”)  
- Dual-mode finance path is live with `activated_at` set  

Also present from earlier Phase 2 files:

- `payment_allocations` table  
- `finance_allocation_gates` (includes `activated_by` column from status migration)  
- `finance_event_audits`  

---

## 5. Current migration history (finance-relevant, object-based)

| Migration / capability | Present? |
|---|---|
| `150000` schema (`payment_allocations`, gates, audits) | **Yes** |
| `150010` diagnostics RPCs | Present earlier in session; this probe’s later RPC calls hit transient `fetch failed` — tables/gates confirm schema path |
| `150100` backfill RPCs | **Yes** (executed successfully; audit + gate) |
| `150200` activation | **Yes** (RPC + activated gate) |
| `150300` status / `activated_by` | **Yes** (`activated_by` column on gates) |
| CLI `schema_migrations` tracking | **No** — not used on this project |

---

## 6. Current finance migration status (from gate)

| Signal | Value |
|---|---|
| Finance mode | **ALLOCATION_ENABLED** |
| Schema installed | **true** |
| Backfill | **Completed** (`2026-07-22T13:10:56Z`) |
| Validation | **ok** (`blocking_issue_count: 0`) |
| Activation | **Active** (`2026-07-22T13:13:23Z`) |
| Allocation rows | **0** (no completed payments to allocate) |
| Available credit readiness | **Ready** (mode enabled; credit still 0 with no payments) |

---

## 7. Is the deployed app using allocation-based payment behaviour?

### **Yes — app + database are aligned for allocation mode**

| Check | Result |
|---|---|
| Deployed worker | Live at `bfa-sms-staging.nasalifya007.workers.dev` (serves login) |
| Deployed commit content | Includes allocation UI, apply-credit action, migration status page (`7338143`) |
| Database mode | **ALLOCATION_ENABLED** |
| Behaviour implication | New payments / credit / void paths use activated allocation RPCs on this pre-prod DB |

(Unauthenticated fetch of `/dashboard/settings/finance-migration` correctly redirects to sign-in.)

---

## 8. Pending finance migrations?

### **None remaining in repo for Phase 2 finance**

All of `150000` → `150300` appear applied. No further Phase 2 finance SQL files are pending.

Non-finance items may still be incomplete on this DB (e.g. earlier probes for profile-change / production-reset) — out of scope for this finance-state report unless you ask to inventory those separately.

---

## Current finance snapshot (read-only)

| Metric | Value |
|---|---|
| Students | 21 (all `enrolled`) |
| Active charges | 5 |
| Active charge value | ZMW 2,750 |
| Cancelled charges | 0 |
| Completed payments | 0 |
| Voided payments | 0 |
| Receipts | 0 |
| Payment allocations | 0 |

---

## What Phase 2.5 / 2.6 plans are *not* applicable as written

Those plans assumed **LEGACY** + inactive schema + dry-run → approve → backfill → activate.

**Actual state:** backfill done, activation done, app deployed with allocation UI.

Therefore:

- Do **not** re-run Phase 2.6 “inactive migrations + dry-run approval” as if starting fresh.  
- Do **not** re-backfill or re-activate.  
- Do **not** force LEGACY.

---

## Recommended next phase of work

### **Phase 3 — Pre-production functional & failure verification (post-activation)**

Focus on proving behaviour on the already-activated system:

1. **Functional smoke tests** (controlled, small amounts on pre-prod):  
   exact payment, overpayment → credit, apply credit, void, receipt, fee-balance reports  
2. **Failure / safety checks:**  
   idempotent payment, unauthorized activation denied, rerun backfill does not duplicate (optional dry observation only)  
3. **Admin status UI check:** Settings → Finance migration readiness → Allocation Enabled  
4. **Fill** `docs/FINANCE_ALLOCATION_PRODUCTION_READINESS_REPORT.md` with READY / NOT READY  
5. Only then plan any **production cutover / promotion** (separate change window)

Optional later: introduce Supabase CLI migration tracking so “last migration” is queryable without object probes.

---

## Confirmations for this session

| Action | Done? |
|---|---|
| Real backfill re-run | **No** |
| Re-activation | **No** |
| Force LEGACY | **No** |
| Deploy | **No** |
| Data modification | **No** |
| Destructive operations | **No** |
