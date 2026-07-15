# V1 Readiness Audit — Blessed Faith Academy SMS

**Date:** 2026-07-16  
**Scope:** Full repository (Next.js app + 18 Supabase migrations). No application or migration changes were made in this pass.  
**Checks run:** `npm run lint` (pass), `npm run build` + TypeScript (pass). **No automated tests** found in the repository.

**Verdict:** Strong foundation (RLS on tables, role helpers, `numeric` money, cash removed, dual-layer authz on most writes). **Not ship-clean for production finance/privacy** until Critical and High items are fixed — especially payment immutability, signup privilege escalation, medical data exposure, and missing payment reversal.

---

## 1. Architecture map

### Main application routes

| Route | Purpose |
|---|---|
| `/login` | Staff sign-in |
| `/dashboard` | Home |
| `/dashboard/students`, `/new`, `/[id]` | Students list, add existing, profile |
| `/dashboard/applications`, `/new`, `/[id]` | Applications list, create, review |
| `/dashboard/fees` | Fee catalogue and requirements list |
| `/dashboard/payments/[id]/receipt` | Printable payment receipt |
| `/dashboard/attendance`, `/[classId]`, `/covers` | Attendance register and cover management |
| `/dashboard/rules` | School rules |
| `/dashboard/discipline` | School-wide discipline incidents |
| `/dashboard/reports` | Reports hub |
| `/dashboard/reports/fee-balances` | Fee balance report + CSV/print |
| `/dashboard/reports/attendance` | Attendance report + CSV/print |
| `/dashboard/reports/enrolment` | Enrolment by class + CSV/print |
| `/dashboard/staff` | Administrator staff management |
| Proxy (`src/proxy.ts`) | Session refresh; redirect unauthenticated users |

### Feature folders (`src/features/`)

| Feature | Role |
|---|---|
| `auth` | Current user, login schema, sign-out |
| `staff` | Create staff, roles, activate/deactivate |
| `students` | Enrol existing students, list, profile queries |
| `applications` | Application create/review |
| `fees` | Charges, payments, optional fees, requirements |
| `attendance` | Register, covers, history |
| `discipline` | Rules, incidents, resolve |
| `reports` | Aggregations, CSV helpers, print actions |

### Server Actions

All under `"use server"` with Zod validation:

- `src/features/staff/actions.ts`
- `src/features/students/actions.ts`
- `src/features/applications/actions.ts`
- `src/features/fees/actions.ts`
- `src/features/attendance/actions.ts`
- `src/features/discipline/actions.ts`

Reports have queries only (no mutations).

### Database query modules

Matching `queries.ts` files in each feature folder, plus `src/features/auth/queries/current-user.ts`.

Shared clients:

- `src/lib/supabase/server.ts` — cookie session (RLS applies)
- `src/lib/supabase/browser.ts` — login / sign-out only
- `src/lib/supabase/admin.ts` — service role, `server-only` (staff provisioning)

### Migrations (`supabase/migrations/`)

Applied manually in Supabase SQL Editor, in filename order:

| File | Purpose |
|---|---|
| `20260715120000_core_config_data.sql` | School, years, terms, grades, classes |
| `20260715130000_auth_profiles_roles.sql` | Profiles, roles, RLS helpers, `handle_new_user` |
| `20260715140000_students_guardians_enrollment.sql` | Students, guardians, enrolments, applications |
| `20260715150000_student_enrolment_functions.sql` | Enrolment RPCs |
| `20260715160000_application_workflow.sql` | Approve / reject |
| `20260715170000_align_enrolment_form.sql` | Official form fields |
| `20260715180000_fees_charges_payments.sql` | Fees model + seed |
| `20260715180100_remove_cash_payment_method.sql` | Remove cash |
| `20260715190000_generate_charges.sql` | Mandatory charge generation |
| `20260715200000_record_payment.sql` | Record payment + receipt |
| `20260715210000_optional_fee_opt_in.sql` | Meal / uniform charges |
| `20260715220000_student_requirement_checks.sql` | Requirements ticks |
| `20260715230000_cancel_optional_charge.sql` | Cancel optional charge |
| `20260715240000_attendance.sql` | Attendance + covers |
| `20260715240100_attendance_ui_helpers.sql` | List classes / teachers RPCs |
| `20260715240200_fix_list_classes_for_attendance.sql` | Fix ambiguous `id` |
| `20260715250000_discipline_and_rules.sql` | Rules + incidents |
| `20260715250100_seed_school_rules_if_empty.sql` | Seed rules if empty |

### Key RPC functions

**Auth / role helpers (mostly SECURITY DEFINER + `search_path = public`):**  
`handle_new_user`, `current_user_role`, `current_user_school_id`, `is_administrator`, `can_manage_students`, `can_review_applications`, `can_manage_fees`, `can_manage_attendance_covers`, `can_take_attendance`, `can_manage_school_rules`, `can_record_discipline`, `can_manage_discipline`, `list_classes_for_attendance`, `list_teachers_for_cover`, `set_class_homeroom_teacher`

**Domain (mostly SECURITY INVOKER + `search_path = public`):**  
`suggest_admission_number`, `create_enrolled_student`, `create_application`, `approve_application`, `reject_application`, `suggest_receipt_number`, `create_charges_for_student`, `create_charges_for_class`, `record_payment`, `create_optional_charge`, `cancel_optional_charge`, `set_requirement_received`, `assign_attendance_cover`, `revoke_attendance_cover`, `save_class_attendance`, `create_discipline_incident`, `resolve_discipline_incident`

**Trigger:** `set_updated_at` (INVOKER; **no** `search_path` set)

### Authentication flow

1. User signs in via browser anon client (`src/app/login/login-form.tsx`).
2. `src/proxy.ts` refreshes the session; unauthenticated users are redirected to `/login`.
3. Dashboard layout loads profile via `getCurrentUser()`; deactivated staff (`is_active = false`) see a blocked screen and can only sign out.
4. Mutations re-check session + `is_active` + role in Server Actions; Postgres RLS and `can_*` helpers enforce authorization.

### Authorization flow

```
UI nav / page redirect
  → Server Action role + is_active check
    → Supabase server client (RLS)
      → RPC can_* helpers / table policies
```

The database is the real security boundary. UI checks are convenience only.

---

## 2. Findings by severity

For every finding: Description, Risk, Exact files, Recommended fix, Migration required?, How to test.

### Critical

#### C1 — Signup trigger can grant any role from user metadata

- **Description:** `handle_new_user` inserts  
  `coalesce((new.raw_user_meta_data->>'role')::public.staff_role, 'secretary')`.  
  A client that can create an Auth user with metadata `role: administrator` becomes an administrator.
- **Risk:** Privilege escalation; full system takeover if public signup or invite metadata is allowed.
- **Exact files:**  
  `supabase/migrations/20260715130000_auth_profiles_roles.sql` (function `handle_new_user`, ≈ lines 52–68)  
  Staff creation path: `src/features/staff/actions.ts` (trusted admin path after Auth user create)
- **Recommended fix:** Ignore client-supplied role in the trigger; always insert a least-privilege default (e.g. `teacher` or `secretary`). Set the real role only via administrator staff management after create. Disable public signup in the Supabase project.
- **Migration required:** Yes (replace `handle_new_user`).
- **How to test:** Attempt Auth signup/invite with `raw_user_meta_data.role = administrator` → profile must not be administrator. Admin `createStaff` with intended role still works.

#### C2 — Completed payments (and charges) can be hard-deleted or amount-edited

- **Description:** RLS policies `payments_delete`, `payments_update`, `charges_delete`, `charges_update` allow any fee manager (`can_manage_fees`) to DELETE rows or UPDATE amounts/receipts. Payment status enum includes `voided`, but there is **no** void/reversal RPC or UI. Operational rules require: completed payments must never be deleted; reversals must preserve the original payment.
- **Risk:** Ledger wipe, silent amount tampering, corrupted balances, loss of audit trail. Staff may delete instead of reversing.
- **Exact files:**  
  `supabase/migrations/20260715180000_fees_charges_payments.sql` (policies ≈ 290–309)  
  `supabase/migrations/20260715200000_record_payment.sql` (insert `completed` only)  
  No void/reversal in `src/features/fees/`
- **Recommended fix:**  
  1. Revoke DELETE on `payments` (and restrict UPDATE so amount, method, receipt_number, paid_on cannot change).  
  2. Add `void_payment(payment_id, reason)` that marks the original `voided` (or inserts a linked reversal row) without deleting.  
  3. Restrict charge deletes similarly; prefer status `cancelled`/`waived` via RPCs only.  
  4. Ensure no UI can delete payments.
- **Migration required:** Yes.
- **How to test:** As bursar, attempt REST/client delete or amount update on a completed payment → denied. Void via RPC → original row remains; balance reflects void; receipt still viewable as voided.

#### C3 — Bursars (and other staff) can read medical / vaccination data

- **Description:** `students_select` allows any authenticated user in the school to read all student columns. Student and application profile pages display medical notes, vaccination, and related fields to anyone who can open the page (including bursar and teacher). Operational expectation: bursars must not access restricted medical information.
- **Risk:** Sensitive health data exposure beyond need-to-know (privacy / safeguarding).
- **Exact files:**  
  `supabase/migrations/20260715140000_students_guardians_enrollment.sql` (`students_select`)  
  `src/app/dashboard/students/[id]/page.tsx` (medical notes / vaccination details)  
  `src/app/dashboard/applications/[id]/page.tsx`  
  `src/features/students/queries.ts`, `src/features/applications/queries.ts` (select `medical_notes`, vaccination fields)
- **Recommended fix:** Move medical fields to a separate table with RLS limited to administrator / headteacher / secretary (or a dedicated clinical role), **or** use a SECURITY DEFINER view / column privilege pattern and redact in queries for bursar and teacher. Hide fields in UI for unauthorized roles.
- **Migration required:** Likely yes (table or policies).
- **How to test:** Sign in as bursar → open student profile → medical/vaccination fields absent or inaccessible via API. Secretary/headteacher still see them.

---

### High

#### H1 — Optional charges can be cancelled after payment

- **Description:** `cancel_optional_charge` rejects only when status is already `cancelled`. It does not require `status = 'outstanding'`. The fee statement “Remove” control does not check charge status either.
- **Risk:** Cancelling a paid meal/uniform charge understates liability; money integrity break.
- **Exact files:**  
  `supabase/migrations/20260715230000_cancel_optional_charge.sql`  
  `src/features/fees/components/fee-statement.tsx`
- **Recommended fix:** RPC: `if v_status <> 'outstanding' then raise ...`. UI: show Remove only for outstanding optional charges.
- **Migration required:** Yes.
- **How to test:** Create optional charge → record payment covering it → cancel must fail. Unpaid cancel must succeed.

#### H2 — No unique constraint on charges (race can duplicate bills)

- **Description:** Charge generation and optional opt-in use application-level `exists` checks only. There is no database unique constraint on the natural key (student + fee item + term/year for active charges).
- **Risk:** Concurrent or double-click generation creates duplicate tuition/extras.
- **Exact files:**  
  `supabase/migrations/20260715180000_fees_charges_payments.sql` (charges table)  
  `supabase/migrations/20260715190000_generate_charges.sql`  
  `supabase/migrations/20260715210000_optional_fee_opt_in.sql`
- **Recommended fix:** Partial unique indexes on non-cancelled charges for the appropriate natural keys (tuition/extras per term; meals per term; uniforms per year).
- **Migration required:** Yes.
- **How to test:** Fire two parallel `create_charges_for_student` calls → only one set of mandatory charges.

#### H3 — CSV exports vulnerable to spreadsheet formula injection

- **Description:** `csvField` escapes quotes/commas/newlines but does not neutralize leading `=`, `+`, `-`, `@` (or tab/CR).
- **Risk:** Formula execution when a staff member opens CSV in Excel/LibreOffice.
- **Exact files:**  
  `src/features/reports/csv.ts`  
  Used by:  
  `src/app/dashboard/reports/fee-balances/page.tsx`  
  `src/app/dashboard/reports/attendance/page.tsx`  
  `src/app/dashboard/reports/enrolment/page.tsx`
- **Recommended fix:** Prefix dangerous cells with `'` or a tab; treat formula-leading characters as requiring quoting + neutralization.
- **Migration required:** No.
- **How to test:** Export a student name of `=1+1` or `=CMD|'...'` → opens as plain text, not a formula.

#### H4 — Incomplete / draft applications can be approved; rejection notes optional

- **Description:** `approve_application` allows status `submitted` **or `draft`** and does not verify `consent_agreed`, guardian presence, or other completeness rules. `rejectApplicationSchema` allows empty notes.
- **Risk:** Enrolment without consent or incomplete data; rejections without recorded reason.
- **Exact files:**  
  `supabase/migrations/20260715160000_application_workflow.sql` (`approve_application`, `reject_application`)  
  `src/features/applications/schemas.ts`  
  `src/features/applications/actions.ts`
- **Recommended fix:** Approve only `submitted` applications with `consent_agreed = true` and a resolvable class. Require non-empty rejection notes in Zod and RPC.
- **Migration required:** Yes (RPC) + app schema change.
- **How to test:** Draft / no-consent application cannot be approved. Reject without notes fails; with notes, `decision_notes` saved.

#### H5 — Payment reversal workflow is missing

- **Description:** Operational rule: reversals must preserve the original payment. Status `voided` exists on `payments`, but there is no RPC or UI to void/reverse while keeping the original row.
- **Risk:** Staff pressure to hard-delete (see C2) or invent incorrect compensating entries.
- **Exact files:**  
  `supabase/migrations/20260715180000_fees_charges_payments.sql` (payment_status enum)  
  `supabase/migrations/20260715200000_record_payment.sql`  
  `src/features/fees/` (no void action)
- **Recommended fix:** Implement `void_payment(p_payment_id, p_reason)` + bursar/admin UI. Balance calculation already filters `status = 'completed'` in app queries — ensure voided are excluded (already true for completed-only sums).
- **Migration required:** Yes.
- **How to test:** Record payment → void → original row present with `voided`; balance restored; receipt printable showing voided state.

#### H6 — Students can be hard-deleted; archive-only not enforced

- **Description:** Operational rule: students should be archived, not permanently deleted. RLS still allows `students_delete` for `can_manage_students`. Status enum includes `withdrawn` / `graduated`, but there is no archive-only write path and no delete ban. FK `ON DELETE RESTRICT` from charges/payments helps only when financial rows exist.
- **Risk:** Loss of enrolment/attendance/discipline history for students without fees.
- **Exact files:**  
  `supabase/migrations/20260715140000_students_guardians_enrollment.sql`  
  `src/features/students/` (no archive action)
- **Recommended fix:** Revoke DELETE (or restrict to super-admin emergency only). Add `archive_student` → status `withdrawn`. Exclude withdrawn from active attendance registers and default lists; keep profile and history readable.
- **Migration required:** Yes.
- **How to test:** Delete student via API → denied. Archive → status withdrawn; history remains; cannot take attendance as active enrollee.

#### H7 — Mid-year class change cannot preserve enrolment history

- **Description:** `unique (student_id, academic_year_id)` on `student_class_enrollments` allows only one row per year. Changing class must overwrite the same row rather than closing the old placement and inserting a new one.
- **Risk:** Lost class history within an academic year.
- **Exact files:**  
  `supabase/migrations/20260715140000_students_guardians_enrollment.sql` (unique constraint)  
  Enrolment RPCs in `…150000` / `…160000`
- **Recommended fix:** Allow multiple enrolment rows per year with statuses (`active`, `transferred`, …). Partial unique index: one `active` enrolment per student per year. Add a transfer RPC that closes the old row and opens a new one.
- **Migration required:** Yes.
- **How to test:** Transfer student mid-year → previous class row `transferred`, new `active`; profile/history shows both.

---

### Medium

#### M1 — UTC “today” for attendance and payment defaults (Zambia is UTC+2)

- **Description:** UI defaults use `new Date().toISOString().slice(0, 10)` (UTC). SQL uses `current_date` (database timezone, often UTC on Supabase). Late evening in Zambia can land on the wrong school day.
- **Risk:** Wrong attendance date or payment date near midnight.
- **Exact files:**  
  `src/app/dashboard/attendance/[classId]/page.tsx`  
  `src/features/fees/components/record-payment-form.tsx`  
  Attendance cover validity in `…240000_attendance.sql` (`current_date`)
- **Recommended fix:** Derive school-local dates with `Africa/Lusaka`. Align RPC date defaults if needed.
- **Migration required:** Optional.
- **How to test:** With system clock in evening ZM time, default register date is still the local school day.

#### M2 — No payment idempotency key

- **Description:** Record payment form uses `isSubmitting` only. Rapid double-submit can create two completed payments with different receipt numbers.
- **Risk:** Accidental double collection on the statement.
- **Exact files:**  
  `src/features/fees/components/record-payment-form.tsx`  
  `supabase/migrations/20260715200000_record_payment.sql`
- **Recommended fix:** Client request id / server idempotency table; optionally ignore duplicate submits within a short window for same student+amount+method.
- **Migration required:** Recommended.
- **How to test:** Double-click Record Payment → only one payment row.

#### M3 — Overpayment not constrained by business rules

- **Description:** `record_payment` requires amount &gt; 0 but does not cap at outstanding balance. Balance can go negative (credit).
- **Risk:** Accidental overpayment unless credit balances are intentional.
- **Exact files:**  
  `src/features/fees/schemas.ts`  
  `src/features/fees/components/record-payment-form.tsx`  
  `…200000_record_payment.sql`
- **Recommended fix:** Confirm school policy. If credits disallowed, reject amount &gt; balance (or warn and require confirmation).
- **Migration required:** Only if enforced in RPC.
- **How to test:** Per policy — either overpay creates credit deliberately, or RPC rejects.

#### M4 — Core config SELECT policies use `using (true)`

- **Description:** Authenticated users can read all schools/years/terms/grades/classes across tenants.
- **Risk:** Cross-school data leak if the project ever hosts more than one school.
- **Exact files:** Core RLS in `20260715120000_core_config_data.sql` (and related alters)
- **Recommended fix:** Scope SELECT to `current_user_school_id()` (with care for bootstrap).
- **Migration required:** Yes (when multi-tenant matters).
- **How to test:** Second school in DB → user of school A cannot read school B config.

#### M5 — Admission number uniqueness is not case-insensitive

- **Description:** Comments imply case-insensitive uniqueness; constraint is plain `unique (school_id, admission_number)`.
- **Risk:** Duplicate admissions differing only by case.
- **Exact files:** `…140000_students_guardians_enrollment.sql`
- **Recommended fix:** Unique index on `lower(admission_number)` per school, or normalize to uppercase on write.
- **Migration required:** Yes.
- **How to test:** Insert `BFA-1` then `bfa-1` → second fails.

#### M6 — No enforcement of a single current academic year / term

- **Description:** Multiple rows can have `is_current = true`.
- **Risk:** Ambiguous charge generation and receipt year prefix.
- **Exact files:** `…120000_core_config_data.sql`
- **Recommended fix:** Partial unique index `(school_id) where is_current` on years/terms.
- **Migration required:** Yes.
- **How to test:** Setting a second current year fails or clears the previous.

#### M7 — No unique constraint on fee schedule natural key

- **Description:** Duplicate `fee_schedules` rows for the same item/year/grade/term are possible; charge generation uses `limit 1`.
- **Risk:** Wrong amount applied non-deterministically.
- **Exact files:** `…180000_fees_charges_payments.sql`, `…190000_generate_charges.sql`
- **Recommended fix:** Unique constraint on natural key (with NULLS NOT DISTINCT if needed).
- **Migration required:** Yes.
- **How to test:** Inserting a duplicate schedule fails.

#### M8 — Attendance corrections are only weakly traceable

- **Description:** `save_class_attendance` upserts and overwrites `status`, `notes`, `recorded_by`. `updated_at` changes; previous values are not stored.
- **Risk:** Cannot prove what mark was corrected from.
- **Exact files:** `…240000_attendance.sql` (`save_class_attendance` ON CONFLICT)
- **Recommended fix:** Attendance history/audit table, or append-only corrections.
- **Migration required:** Yes for full audit.
- **How to test:** Correct absent → present → audit shows previous status and actor.

#### M9 — Hard delete allowed on attendance, discipline incidents, and school rules

- **Description:** DELETE policies exist for managers / attendance takers. Rules use `ON DELETE SET NULL` on incidents.
- **Risk:** Audit gaps; historical discipline lose rule text if rule row deleted.
- **Exact files:**  
  `…240000_attendance.sql`  
  `…250000_discipline_and_rules.sql`
- **Recommended fix:** Prefer soft archive (`is_active` / status); revoke hard DELETE in normal operations.
- **Migration required:** Yes.
- **How to test:** Delete denied; deactivate rule keeps past incidents readable.

#### M10 — Secretary sees Fees nav but cannot manage fees

- **Description:** Layout and fees page allow secretary to **view** the catalogue; `can_manage_fees` and fee actions exclude secretary. Student profile fee management also excludes secretary.
- **Risk:** Confusion, not a security hole if intentional.
- **Exact files:**  
  `src/app/dashboard/layout.tsx`  
  `src/app/dashboard/fees/page.tsx`  
  `src/features/fees/actions.ts`
- **Recommended fix:** Document as view-only, or grant/remove access deliberately.
- **Migration required:** No (unless role matrix changes).
- **How to test:** Secretary opens Fees → read-only; cannot record payment.

#### M11 — Staff email mapping loads all Auth users

- **Description:** `listUsers({ perPage: 1000 })` via service role maps emails for the staff table without school scoping at the Auth API layer.
- **Risk:** Unnecessary exposure of all project Auth emails in memory on the server.
- **Exact files:** `src/features/staff/queries.ts`
- **Recommended fix:** Fetch or map only users matching known profile IDs.
- **Migration required:** No.
- **How to test:** Staff page still shows correct emails; Auth dump not broader than needed.

#### M12 — Students and Applications routes not role-gated in the nav

- **Description:** All logged-in staff with a session see Students and Applications links. Teachers and bursars can open lists; RLS still school-scopes rows. Combined with C3, increases medical exposure surface.
- **Risk:** Broader PII visibility than needed.
- **Exact files:** `src/app/dashboard/layout.tsx`, students/applications pages
- **Recommended fix:** Align nav and page redirects with need-to-know; fix medical separately (C3).
- **Migration required:** No for nav; C3 may need migration.
- **How to test:** Teacher cannot open medical fields; optional: teacher redirected from full student directory if policy requires.

#### M13 — Balance math uses JavaScript `Number` on numeric strings

- **Description:** Charges/payments amounts are cast with `Number(...)` then summed in `getStudentFeeStatement` and reports.
- **Risk:** Usually acceptable for `numeric(12,2)`; edge cases with very large ledgers or many lines.
- **Exact files:** `src/features/fees/queries.ts`, `src/features/reports/queries.ts`
- **Recommended fix:** Prefer integer ngwee (cents) or a decimal library for ledger math.
- **Migration required:** No.
- **How to test:** Statement totals match SQL `sum(amount)` for the same filters.

#### M14 — Guardians are re-created on each enrolment rather than reused

- **Description:** Schema allows one guardian linked to many students via `student_guardians`, but enrolment RPCs insert new guardian rows. No unique on national ID / phone.
- **Risk:** Duplicate guardian records for siblings; harder contact updates.
- **Exact files:** Enrolment/application RPCs in `…150000` / `…160000` / `…170000`
- **Recommended fix:** Optional match-and-link by national ID or phone within school.
- **Migration required:** Optional.
- **How to test:** Enrol sibling with same guardian ID → one guardian, two links.

---

### Low

#### L1 — `set_updated_at` has no `search_path`

- **Files:** `…120000_core_config_data.sql`
- **Fix:** `set search_path = public` on the function.
- **Migration required:** Yes (small).
- **Test:** Trigger still stamps `updated_at`.

#### L2 — Limited `as any` in form helpers

- **Files:** `application-form.tsx`, `add-student-form.tsx`, `guardian-fields.tsx`
- **Fix:** Tighten react-hook-form generics when convenient.
- **Migration required:** No.

#### L3 — Temporary staff password field is `type="text"`

- **Files:** `src/features/staff/components/create-staff-form.tsx`
- **Fix:** Use `type="password"` (with optional reveal).
- **Migration required:** No.

#### L4 — Session without profile can enter dashboard

- **Files:** `src/app/dashboard/layout.tsx`, `src/app/dashboard/page.tsx`
- **Fix:** Redirect to a “contact admin” page if profile missing.
- **Migration required:** No.

#### L5 — Attendance uniqueness is per class, not school-wide student+date

- **Files:** `…240000_attendance.sql`
- **Fix:** Only if product requires one mark per student per day across classes.
- **Migration required:** If required.

#### L6 — Multiple active covers for same class/teacher allowed

- **Files:** `…240000_attendance.sql`
- **Fix:** Optional overlap exclusion constraint.
- **Migration required:** Optional.

#### L7 — No automated test suite

- **Files:** Repository has no `*.test.*` / `*.spec.*`
- **Fix:** Add RPC and critical-path tests before wider rollout.
- **Migration required:** No.

#### L8 — Class-wide charge generation UI incomplete

- **Files:** RPC `create_charges_for_class` exists; limited UI
- **Fix:** Product backlog item.
- **Migration required:** No.

---

## 3. Topic review checklist (audit questions)

| Topic | Result | Notes |
|---|---|---|
| Cash not available | **Pass** | Enum is mobile_money \| bank_transfer; `…180100` remaps legacy cash |
| Payment methods only MM + bank | **Pass** | App Zod + RPC enum |
| Receipt numbers unique | **Pass** | `unique (school_id, receipt_number)` |
| Amount must be &gt; 0 | **Pass** | Zod + RPC |
| Double-submit safe | **Partial** | UI disable only (M2) |
| Payments cannot be deleted | **Fail** | C2 |
| Reversals preserve original | **Fail** | H5 missing |
| Cancel optional only when unpaid | **Fail** | H1 |
| Balances from valid charges + completed payments | **Pass** | App excludes cancelled charges and non-completed payments (H1 can break integrity) |
| Concurrent payment corruption | **Partial** | Receipt lock + unique; charge races H2 |
| Money as PostgreSQL `numeric` | **Pass** | `numeric(12,2)` |
| Displays use Kwacha formatting | **Pass** | `formatKwacha` / `en-ZM`; CSV uses `toFixed(2)` |
| Disabled staff cannot use system | **Pass** | Layout + action `is_active` checks |
| Users cannot self-assign higher role via staff UI | **Pass** | Admin-only; cannot demote/deactivate self |
| Signup metadata role escalation | **Fail** | C1 |
| UI not the only protection | **Pass** | Most writes also RLS/RPC |
| Teachers only permitted classes | **Pass** | Homeroom + cover + RPC |
| Bursars cannot access medical info | **Fail** | C3 |
| Service role never in client | **Pass** | `server-only` admin client |
| Protected routes need session | **Pass** | Proxy + layout |
| Duplicate active enrolment same year | **Pass** | Unique student+year (blocks history — H7) |
| Duplicate student numbers | **Pass** | Unique admission; case gap M5 |
| Approve incomplete applications | **Fail** | H4 |
| Rejection reasons saved | **Partial** | Optional notes |
| Guardians linked to multiple students | **Partial** | Schema yes; RPCs create new rows (M14) |
| Class changes preserve history | **Fail** | H7 |
| Archived students excluded without losing history | **Fail** | H6 — delete still allowed; archive UX missing |
| Duplicate attendance same student+date (per class) | **Pass** | Unique + upsert |
| Attendance corrections traceable | **Partial** | M8 |
| Zambia timezone-safe dates | **Fail** | M1 |
| Discipline FKs / resolve roles / archived rules | **Pass** | Resolve gated; inactive rules blocked on new links; hard delete Medium |
| Reports respect RLS | **Pass** | Page role gates + school RLS |
| CSV formula injection protected | **Fail** | H3 |
| Date filters inclusive / timezone-safe | **Partial** | Inclusive YYYY-MM-DD; timezone M1 |
| Unauthorized export blocked | **Pass** | Fee report excludes teachers; others rely on RLS + page gates |
| `npm run lint` | **Pass** | |
| `npm run build` / TypeScript | **Pass** | |
| Automated tests | **None** | L7 |

---

## 4. End-to-end workflow readiness checklist

Use this after Critical/High fixes. Current status noted.

### 1. Application to approved enrolment

- [ ] Create application with guardians and consent  
- [ ] Submit appears in list as submitted  
- [ ] Incomplete / draft / no-consent **cannot** be approved (fix H4)  
- [ ] Approve into class → student `enrolled`, enrolment row created  
- [ ] Reject with required notes → `decision_notes` saved, student rejected  

**Current:** Works for happy path; draft/consent gaps (H4).

### 2. Existing student registration

- [ ] Add existing student with guardians and class  
- [ ] Admission number unique  
- [ ] Appears on students list and profile  

**Current:** Works.

### 3. Mandatory fee generation

- [ ] Generate charges for enrolled student/current term  
- [ ] Tuition + extras match schedule  
- [ ] Second generate does not duplicate (fix H2)  

**Current:** Works; race duplicate risk (H2).

### 4. Optional meal or uniform charge

- [ ] Opt in meal (one per term) / uniform items  
- [ ] Appears on statement  
- [ ] Cancel unpaid succeeds; cancel paid fails (fix H1)  

**Current:** Opt-in works; paid cancel not blocked (H1).

### 5. Partial payment

- [ ] Record amount &lt; balance via mobile money or bank transfer  
- [ ] Cash not available  
- [ ] Balance decreases correctly  
- [ ] Double-click does not create two payments (fix M2)  

**Current:** Works; idempotency gap (M2).

### 6. Receipt printing

- [ ] Open `/dashboard/payments/[id]/receipt`  
- [ ] Receipt number unique; amount in Kwacha  
- [ ] Print layout hides chrome  

**Current:** Works.

### 7. Payment reversal

- [ ] Void/reverse completed payment without deleting row (fix H5 / C2)  
- [ ] Original payment preserved; balance restored  
- [ ] Voided payment not counted in totals  

**Current:** **Not implemented.**

### 8. Requirements submission

- [ ] Tick requirements on student profile  
- [ ] Progress updates; not billed  

**Current:** Works.

### 9. Attendance recording and correction

- [ ] Homeroom/cover assigned  
- [ ] Teacher sees only permitted classes; office sees all  
- [ ] Save register; unique per student/class/date  
- [ ] Correction updates mark; audit trail acceptable (fix M8)  
- [ ] Default date correct for Africa/Lusaka (fix M1)  

**Current:** Core works; timezone and audit gaps.

### 10. Discipline incident and resolution

- [ ] Teacher/secretary records incident (optional active rule)  
- [ ] Teacher cannot resolve  
- [ ] Admin/head/secretary resolve with notes/timestamps  
- [ ] Deactivated rule does not break past incidents  

**Current:** Works.

### 11. Report printing and CSV export

- [ ] Fee balances / attendance / enrolment load under RLS  
- [ ] Totals match underlying filters  
- [ ] Print works  
- [ ] CSV safe from formula injection (fix H3)  
- [ ] Unauthorized roles cannot export restricted reports  

**Current:** Works; CSV injection (H3).

### 12. Role access for every staff role

| Capability | Administrator | Headteacher | Secretary | Bursar | Teacher |
|---|---|---|---|---|---|
| Staff management | ✓ | — | — | — | — |
| Approve/reject applications | ✓ | ✓ | — | — | — |
| Manage students / enrol | ✓ | ✓ | ✓ | view* | view* |
| View fee catalogue | ✓ | ✓ | ✓ | ✓ | — |
| Generate charges / record payment | ✓ | ✓ | — | ✓ | — |
| Medical / vaccination fields | ✓ | ✓ | ✓ | **must be —** (C3) | **must be —** (C3) |
| Attendance any class | ✓ | ✓ | ✓ | — | — |
| Attendance homeroom/cover | ✓ | ✓ | ✓ | — | ✓ |
| Edit school rules | ✓ | ✓ | — | — | — |
| Record discipline | ✓ | ✓ | ✓ | — | ✓ |
| Resolve discipline | ✓ | ✓ | ✓ | — | — |
| Fee balance reports | ✓ | ✓ | ✓* | ✓ | — |
| Other reports | ✓ | ✓ | ✓ | ✓* | ✓* |

\*Confirm product policy for view-only access.  
**Current:** Mostly aligned; fix C1, C3, and document secretary fee view (M10).

**Deactivated staff:** Cannot use dashboard; actions that check `is_active` reject mutations.  
**Self role escalation via Staff UI:** Blocked.  
**Service role:** Server-only.

---

## 5. Code quality snapshot

| Check | Result |
|---|---|
| TypeScript (`next build`) | Pass |
| ESLint (`npm run lint`) | Pass |
| `any` / unsafe assertions | Low use in form helpers only |
| Client DB writes for business data | None observed (browser client used for auth only) |
| Server Actions + Zod | Present on mutating features |
| Secrets in logs | No `console.log` of secrets found in `src` |
| Env usage | `SUPABASE_SERVICE_ROLE_KEY` only in `src/lib/supabase/admin.ts` (`server-only`) |
| Automated tests | None |

---

## 6. Recommended fix order (awaiting approval)

Do **not** implement until explicitly approved.

1. **C2 + H5** — Payment immutability + void/reversal workflow  
2. **C1** — Harden `handle_new_user`; confirm public signup disabled  
3. **C3** — Restrict medical/vaccination data by role  
4. **H1** — Cancel optional charges only when outstanding  
5. **H2** — Unique constraints / partial indexes on charges  
6. **H3** — CSV formula-injection escape  
7. **H4** — Tighten approve/reject validation  
8. **H6 + H7** — Archive students; enrolment transfer history  
9. **M1 + M2** — Africa/Lusaka dates; payment idempotency  

---

## 7. Summary

**Blockers for production V1**

1. Payments and charges can still be deleted or edited; no safe reversal that preserves originals.  
2. Auth signup metadata can create administrators.  
3. Medical notes and vaccination data are readable by bursars (and other school staff) via school-wide student SELECT.

**Next tier**

- Cancel paid optional charges  
- Duplicate charge races  
- CSV formula injection  
- Approve incomplete applications  
- Hard-delete students instead of archive  
- No mid-year enrolment history  

**Already in good shape**

- Cash removed; payment methods limited  
- Money stored as `numeric(12,2)`  
- Receipt uniqueness; amount &gt; 0 enforced  
- Deactivated staff blocked  
- Service role isolated server-side  
- Attendance cover / homeroom RBAC  
- Discipline resolve correctly excludes teachers  
- Kwacha formatting in primary UI  
- Dual-layer authorization on most Server Actions  
- `npm run lint` and `npm run build` succeed  

---

*End of audit. No application code, migrations, or configuration were modified while producing this document.*
