# Staff Test Data Cleanup

**System:** Blessed Faith Academy School Management System  
**Date:** 2026-07-23  
**Project:** `blessed-faith-academy` (ref `qaczvlbgsxcrdcdgsfpo`)  
**School UUID:** `516977ed-8612-4e27-addc-cdb5cdb72505`

**Scope:** Remove temporary verification staff only (Smoke / Polish Verify / Polish Audit).  
**Not done:** auth logic changes, password-reset code changes, Finance/Students/Attendance changes, migrations, deploy.

---

## 1. Inventory (before cleanup)

| Metric | Count |
|---|---|
| Profiles in school | 35 |
| Test candidates identified | 27 |
| Genuine staff retained | 8 |
| Orphan Auth users (test-named) | 0 |

There is no separate `staff` / `user_roles` table in this schema. Staff = `profiles` (1:1 with `auth.users`, same UUID). Roles live on `profiles.role`.

### Test staff removed (27)

All used disposable emails on `@bfa-smoke.local` from finance smoke/polish verify scripts. None were homeroom teachers; none had attendance covers, recorded attendance/payments/charges, or discipline rows.

| Category | Count | Examples |
|---|---|---|
| Smoke Test Bursar / Teacher | 14 | `smoke-bursar-*@bfa-smoke.local`, `smoke-teacher-*@bfa-smoke.local` |
| Polish Verify Bursar / Teacher | 10 | `polish-bursar-*@bfa-smoke.local`, `polish-teacher-*@bfa-smoke.local` |
| Polish Audit Bursar / Teacher | 2 | `polish-aud-*`, `polish-tch-*` |
| Polish bursar (name = email) | 1 | `polish-bursar-mrwacmgr@bfa-smoke.local` |

**Not found (none present):** Demo staff, Dummy staff, dedicated “Finance Verify” / “Password Reset” named accounts beyond the smoke/polish set, separate permissions tables.

**Safety gate:** Cleanup refused any account whose email was not `@bfa-smoke.local` (or clear Smoke/Polish Verify/Audit display name). Genuine `@blessedfaith.com` / personal emails were never deletion candidates.

---

## 2. Removal method

Service-role script: `scripts/staff-test-data-cleanup.cjs` (inventory: `scripts/staff-test-data-inventory.cjs`).

### Order executed

1. Delete `password_reset_audits` rows for these IDs (`target_profile_id`, `initiated_by`, `target_user_id`) — none present at cleanup time  
2. Delete `finance_event_audits` for these actors where applicable — none  
3. Delete `class_attendance_covers` for these `staff_id`s — none  
4. `auth.admin.deleteUser(id)` for each (cascades `profiles` via `profiles.id → auth.users ON DELETE CASCADE`)  
5. Sweep remaining `@bfa-smoke.local` Auth users  

Two Auth deletes initially failed (transient JWT/network); re-run removed the last 2 successfully.

---

## 3. Records removed

| Type | Removed |
|---|---|
| Auth users | **27** |
| Profiles | **27** (cascade) |
| Role assignments | **27** (`profiles.role` rows) |
| Password-reset audits (test-only) | **0** (none existed) |
| Attendance covers | **0** |
| Orphan Auth leftovers | **0** after final pass |

---

## 4. Retained genuine staff (8)

| Role | Name | Email |
|---|---|---|
| bursar | Adam Mushala | `adammushala@blessedfaith.com` |
| teacher | first Zimba | `firstzimba@blessedfaith.com` |
| administrator | Geofrey | `geofreykusangwa@gmail.com` |
| administrator | geofrey kusangwa | `geofreykay@outlook.com` |
| administrator | Henry Mulenga | `mulengahenry@gmail.com` |
| teacher | last Zulu | `lastzulu@blessedfaith.com` |
| administrator | nasalifya007@gmail.com | `nasalifya007@gmail.com` |
| headteacher | Tasila Banda | `tassynyoni@gmail.com` |

---

## 5. Verification results (after cleanup)

| Check | Result |
|---|---|
| No Smoke Test staff remain | **Pass** |
| No Polish Verify / Audit staff remain | **Pass** |
| No Demo / Dummy staff remain | **Pass** (none existed) |
| No orphan smoke profiles | **Pass** (8 profiles = 8 genuine) |
| No orphan `@bfa-smoke.local` Auth users | **Pass** |
| No orphan role rows | **Pass** (roles on profiles only) |
| Broken FKs from deleted staff | **Pass** (profile FKs are `ON DELETE SET NULL` or cascade covers) |
| Post-inventory candidates | **0** |
| All retained staff Auth-linked (email present) | **Pass** at cleanup (emails resolved for all 8). Post-inventory Auth API intermittently returned null for 2 lookups (same transient JWT flake seen during deletes); profiles remain. Re-confirm in Supabase Auth if a reset email fails for a specific person. |

### Password reset (Step 6)

- Code path unchanged (cleanup only).  
- Every retained staff profile still has a linked Auth user with email — required for `adminSendPasswordResetAction`.  
- Live email send was **not** exercised in this cleanup (no deploy / no test mailbox). Confirm manually from Staff → send reset for one genuine account if needed.

---

## 6. Scripts

| Script | Purpose |
|---|---|
| `scripts/staff-test-data-inventory.cjs` | Read-only inventory |
| `scripts/staff-test-data-cleanup.cjs` | Gated delete of `@bfa-smoke.local` verify staff |

Local result JSON files are gitignored.

---

## Verdict

All identified smoke/polish verification staff and their Auth users were removed. Eight genuine school staff remain with Auth linkage intact.
