# Finance Test Data Cleanup

**System:** Blessed Faith Academy School Management System  
**Date:** 2026-07-22  
**Project:** `blessed-faith-academy` (ref `qaczvlbgsxcrdcdgsfpo`)  
**School UUID:** `516977ed-8612-4e27-addc-cdb5cdb72505`

**Scope:** Remove temporary Finance verification / polish smoke data only.  
**Not done:** migrations, activation, backfill, architecture changes, deploy, deletion of genuine school data.

---

## 1. Inventory (before cleanup)

### Genuine students retained (21)

All `BFA-2026-*` enrolled pupils (examples: Sharma Phiri, Monalisa Malisawa, … Shadrick Chilindi). None matched smoke/polish naming.

### Test students identified (14)

| Admission | Name | Origin |
|---|---|---|
| `SMOKE-MRW7PP3N` … `SMOKE-MRW8NL6I` (9) | Smoke Pupil | Phase 3.2 finance smoke |
| `POLISH-MRW9YTHQ` … `POLISH-MRWAICU0` (4) | Polish Verify | Finance polish snapshot verify |
| `PAUD-MRWAYRHN` (1) | Polish Audit | Finance polish audit/security verify |

### Related test finance artefacts (before)

| Artefact | Count |
|---|---|
| Payments / receipts (`BFA-R-2026-0001` … `0019`, SMOKE/POLISH/PAUD refs) | 19 |
| Charges | 42 |
| Payment allocations | 24 |
| Payment finance snapshots | 5 |
| Finance event audits | 81 |
| Enrolments | 14 |
| Test-only guardians | 4 |
| Attendance / discipline for these students | 0 / 0 |

**Safety gate:** cleanup refused any admission starting with `BFA-`.

---

## 2. Removal method

- Supported app workflows do not provide hard-delete for completed/voided payments or students with ledger history.
- Used **service-role** deletes in dependency order via `scripts/finance-test-data-cleanup.cjs` after read-only inventory (`scripts/finance-test-data-inventory.cjs`).
- Only rows tied to the 14 confirmed test student IDs were deleted.

### Order executed

1. `payment_finance_snapshots`  
2. `payment_allocations`  
3. `finance_event_audits`  
4. `payments`  
5. `charges`  
6. `student_guardians` links  
7. `student_class_enrollments`  
8. Orphan `guardians` (test-only)  
9. `students`

---

## 3. Records removed

| Type | Removed |
|---|---|
| Students | **14** (all SMOKE / POLISH / PAUD listed above) |
| Payments / receipts | **19** |
| Charges | **42** |
| Allocations | **24** |
| Snapshots | **5** |
| Finance audits | **81** |
| Enrolments | **14** |
| Guardian links | **4** |
| Guardians | **4** |
| Attendance | **0** |
| Discipline | **0** |

---

## 4. Records intentionally retained

| Item | Why |
|---|---|
| 21 `BFA-2026-*` students | Genuine school data |
| 5 charges | Remaining school charges (opening / legitimate) — **not** test charges |
| 0 payments | Expected after removing only verification receipts (activation had no real completed payments; all `BFA-R-2026-0001`–`0019` were verification) |
| Fee items, schedules, gates, allocation activation | Architecture / config — untouched |
| Academic years, terms, classes, grade levels | Untouched |
| Disposable Auth users (`*@bfa-smoke.local`) | Not pupil finance rows; left in Auth (may be banned from verify runs) |

---

## 5. Post-cleanup verification

| Check | Result |
|---|---|
| SMOKE / POLISH / PAUD students remain | **0** |
| Test reference payments remain | **0** |
| Orphan allocations | **0** |
| Orphan snapshots | **0** |
| Over-allocated completed payments | **0** |
| Genuine sample still present | `BFA-2026-1173` Sharma Phiri |

### Remaining counts (school)

| Metric | Count |
|---|---|
| Students | **21** |
| Payments | **0** |
| Charges | **5** |
| Allocations | **0** |
| Snapshots | **0** |
| Finance audits | **0** |

### Reconciliation

With zero completed payments and zero active allocations, paid − allocated = credit holds trivially. No over-allocation detected. Activation gate was **not** modified.

---

## 6. Confirmation

Only finance verification test pupils and their dependent finance/enrolment/guardian rows were removed. Genuine `BFA-2026-*` students and remaining school charges were preserved. No migrations, activation, backfill, or deploy.

---

## Verdict

# TEST DATA CLEANUP COMPLETE
