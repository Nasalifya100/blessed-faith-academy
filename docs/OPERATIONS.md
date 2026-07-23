# Operations & developer guide

Setup, database migrations, architecture, and maintenance for the Blessed Faith Academy School Management System.

App root: `blessed-faith-academy/`

---

## Environment variables

Copy `.env.example` to `.env.local` (never commit `.env.local`):

| Variable | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Project URL from Supabase → Settings → Data API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Anon/publishable key; protected by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS — used for admin tasks such as creating staff. Never prefix with `NEXT_PUBLIC_` |

Get values from the Supabase dashboard: **Project Settings → API**.

---

## Local development

```bash
cd blessed-faith-academy
npm install
npm run dev
```

- Dev server: http://localhost:3000  
- Login: `/login`  
- Dashboard: `/dashboard`

```bash
npm run build   # production build + TypeScript check
npm run lint    # ESLint
npm run start   # serve production build
```

---

## Database migrations

Migrations live in `supabase/migrations/`. They are the **source of truth** for schema, RLS, RPCs, and seed data.

**Current process:** run each file in order in the **Supabase SQL Editor** (not auto-applied by the Next.js app). Run the full file contents; do not skip versions.

### Order (required)

| File | Purpose |
|---|---|
| `20260715120000_core_config_data.sql` | School, academic years, terms, grades, classes |
| `20260715130000_auth_profiles_roles.sql` | Profiles, roles, RLS helpers |
| `20260715140000_students_guardians_enrollment.sql` | Students, guardians, enrolments, applications |
| `20260715150000_student_enrolment_functions.sql` | Enrolment RPCs |
| `20260715160000_application_workflow.sql` | Approve / reject application |
| `20260715170000_align_enrolment_form.sql` | Official application form fields |
| `20260715180000_fees_charges_payments.sql` | Fees model + 2026 catalogue seed |
| `20260715180100_remove_cash_payment_method.sql` | Remove cash payment method |
| `20260715190000_generate_charges.sql` | Mandatory charge generation |
| `20260715200000_record_payment.sql` | Record payment + receipts |
| `20260715210000_optional_fee_opt_in.sql` | Meal / uniform opt-in charges |
| `20260715220000_student_requirement_checks.sql` | Requirements checklist ticks |
| `20260715230000_cancel_optional_charge.sql` | Cancel unpaid optional charges |
| `20260715240000_attendance.sql` | Attendance records + cover assignments |
| `20260715240100_attendance_ui_helpers.sql` | List classes / teachers for attendance UI |
| `20260715240200_fix_list_classes_for_attendance.sql` | Fix ambiguous `id` in attendance RPC |
| `20260715250000_discipline_and_rules.sql` | School rules + discipline incidents |
| `20260715250100_seed_school_rules_if_empty.sql` | Seed default rules when a school has none |
| `20260716010000_payment_immutability_and_void.sql` | Payment immutability + `void_payment` |
| `20260716010100_payment_idempotency.sql` | Payment idempotency key + `record_payment` |
| `20260716010200_charge_immutability_and_cancel.sql` | Charge immutability + unpaid cancel guard |
| `20260716010300_charge_unique_indexes.sql` | Unique charge indexes + meal exclusivity |
| `20260716100000_harden_handle_new_user.sql` | Ignore Auth metadata role (default teacher) |
| `20260716100100_harden_profiles_rls.sql` | School-scoped profile write policies |
| `20260716100200_student_medical_privacy.sql` | Medical table + RLS; drop columns from students |
| `20260716100300_archive_student.sql` | Archive RPC; revoke student DELETE |
| `20260716110000_application_review_guards.sql` | Approve/reject validation (consent, guardians, reason) |
| `20260716110100_transfer_student_class.sql` | Mid-year class transfer + one active enrolment per year |
| `20260716120000_config_integrity_constraints.sql` | Admission uniqueness, one current year/term, unique fee schedules |
| `20260716120100_attendance_audit_and_soft_delete.sql` | Attendance correction audit; revoke hard DELETE on attendance/rules/incidents |
| `20260716130000_overpayment_and_school_scoped_select.sql` | Cap payments at balance; school-scope config SELECT |
| `20260716130100_reuse_guardians.sql` | Match/link guardians by NRC or phone on enrol/apply |
| `20260716140000_attendance_uniqueness_and_cover_overlap.sql` | One mark per student/day; no overlapping covers |
| `20260716150100_admission_normalize_on_write.sql` | Uppercase admission on write; fail if case-duplicates |
| `20260716150200_current_term_per_school.sql` | One current term per school; set_current_* RPCs |
| `20260716150300_guardian_safe_reuse.sql` | NRC auto-link; phone only via explicit confirm |
| `20260716150400_revoke_remaining_deletes.sql` | Revoke hard DELETE on remaining operational tables |
| `20260716150500_search_path_indexes_fee_verify.sql` | Indexes; DEFINER search_path; fee unique verify |

### Phase 2 finance allocation (staging verification)

Do **not** apply or activate payment-allocation cutover on production from this guide alone.

Staging process, migration order, diagnostics/backfill/validate/activate checklist, and readiness report:

- `docs/FINANCE_ALLOCATION_STAGING_RUNBOOK.md`
- `docs/FINANCE_ALLOCATION_PRODUCTION_READINESS_REPORT.md`
- `supabase/diagnostics/finance_allocation_staging_verification.sql`

### Sprint 4 pre-apply detection (run in SQL Editor)

Resolve any rows returned **before** applying Sprint 4 migrations. Do **not** delete blindly.

```sql
-- Admission case collisions
select school_id, lower(admission_number) as key, count(*),
       array_agg(id), array_agg(admission_number)
from public.students
group by school_id, lower(admission_number)
having count(*) > 1;

-- Multiple current terms per school
select ay.school_id, count(*), array_agg(t.id), array_agg(t.name)
from public.terms t
join public.academic_years ay on ay.id = t.academic_year_id
where t.is_current
group by ay.school_id
having count(*) > 1;

-- Duplicate fee schedules
select school_id, fee_item_id, academic_year_id, grade_level_id, term_id,
       count(*), array_agg(id), array_agg(amount)
from public.fee_schedules
group by 1,2,3,4,5
having count(*) > 1;
```

**Current year/term:** Administrators switch via **Fees → Current year & term** (`set_current_academic_year` / `set_current_term`). Only one current year and one current term per school.

### Auth / signup (required)

**Public signup must stay disabled.** Staff accounts are created only by administrators via **Dashboard → Staff** (service-role `createUser`), not by self-registration.

#### Confirm in Supabase Dashboard

1. Open the project → **Authentication** → **Providers** → **Email**.
2. Ensure **Enable Email Signup** / **Allow new users to sign up** is **OFF** (wording varies by dashboard version).
3. Under **Authentication** → **URL Configuration**, do not publish a public signup redirect URL for this school app.
4. Prefer **Confirm email** still enabled for admin-created users if you use email confirmation elsewhere; admin create already sets `email_confirm: true`.

#### App behaviour

- `/login` is sign-in only (no “Create account” flow).
- `handle_new_user` ignores metadata roles and defaults new profiles to `teacher`; admins set the real role after create.
- If public signup were ever turned on by mistake, attackers still cannot self-assign `administrator` via metadata, but they could create useless `teacher` accounts — so keep signup off.

#### Quick check

Try opening any public signup URL for the project, or call `supabase.auth.signUp(...)` from a throwaway script with the anon key — it should fail / be rejected when signup is disabled.

### After a failed or partial apply

- Re-run only migrations that did not complete successfully (check error message).
- Prefer idempotent re-runs where the SQL uses `if not exists` / `create or replace`.
- If school rules are empty, run `20260715250100_seed_school_rules_if_empty.sql` (works for any school with zero rules, not only a hard-coded name).

---

## Architecture

```
src/
  app/                 # Next.js App Router pages & layouts
  components/ui/       # Shared UI (shadcn)
  features/            # Domain modules
    auth/
    staff/
    students/
    applications/
    fees/
    attendance/
    discipline/
    reports/
  lib/
    supabase/          # browser, server, and admin (service role) clients
    money.ts           # formatKwacha (locale en-ZM)
supabase/migrations/   # SQL schema, RLS, RPCs, seeds
```

### Patterns

- **Queries** — server-side reads (Supabase client).
- **Actions** — Server Actions that call RPCs or write via the server client.
- **Schemas** — Zod validation at the boundary.
- **RLS** — policies and helpers such as `can_manage_fees()`, `can_take_attendance()`, `current_user_school_id()`.

UI visibility (nav links by role) is a convenience; the database remains the security boundary.

### Money display

Use `formatKwacha` from `src/lib/money.ts` for all user-facing amounts (`en-ZM`).

### Auth notes

- Deactivated profiles (`is_active = false`) keep a session but are blocked in the dashboard layout.
- Service role client must stay server-only (`server-only` package).

---

## Roles (database + UI)

| Role key | Label |
|---|---|
| `administrator` | Administrator |
| `headteacher` | Headteacher |
| `bursar` | Bursar |
| `secretary` | Secretary |
| `teacher` | Teacher |

Nav gating (approximate):

- **Fees catalogue:** administrator, bursar, headteacher, secretary  
  - **Edit amounts / record payments / generate charges:** administrator, bursar, headteacher only  
  - Secretary is **view-only** on Fees (catalogue + requirements); student fee actions on the profile are also excluded  
- **Attendance:** administrator, headteacher, secretary, teacher  
- **Discipline:** administrator, headteacher, secretary, teacher  
- **Staff:** administrator only  
- **Reports / Rules:** most staff roles (see dashboard layout)

Teachers take attendance only for **homeroom** classes or **active cover** assignments.

**Overpayment policy:** Payments cannot exceed the student’s outstanding balance (completed payments vs non-cancelled/waived charges). Credit balances are not created via the payment form/RPC.

**Students directory:** Visible to administrator, headteacher, secretary, and bursar. Teachers open individual profiles via Discipline (or direct link) but do not see the full directory in the nav.

---

## Key RPCs (reference)

Exact names live in the migration files. High-level groups:

| Area | Examples |
|---|---|
| Applications | Approve / reject enrolment application |
| Fees | Generate mandatory charges; create optional meal/uniform charge; cancel optional charge; record payment |
| Requirements | Upsert student requirement checks |
| Attendance | Save class attendance; assign/revoke cover; list classes for attendance |
| Discipline | Create incident; resolve incident |

Attendance marks and discipline incidents are not hard-deleted in normal use. Correct a register mark to overwrite it (prior status is kept in `attendance_record_audits`). Deactivate school rules with `is_active = false`; revoke covers instead of deleting them.

If the UI shows an RPC/function missing error, the matching migration was not applied.

---

## Fee catalogue (seeded 2026)

Defined in `20260715180000_fees_charges_payments.sql` for school name **Blessed Faith Academy**:

- Tuition by grade (K1,200 early childhood/pre-grade; K1,150 Grades 1–7)
- Extras: report book, PTA, maintenance
- Optional meals and uniforms
- Requirement items (checklist, not billed)

Changing published fees for a live year should be done carefully in `fee_schedules` / admin UI — coordinate with the bursar.

---

## Deployment checklist (generic)

1. Set production/staging env vars (same three as local; never expose service role to the client).
2. Confirm all migrations are applied on the target Supabase project.
3. `npm run build` succeeds.
4. Create at least one administrator account.
5. Assign academic year/term and class structure (from core seed or office updates).
6. Smoke-test: login → student → generate charges → payment → attendance → report print/CSV.

---

## Cloudflare Workers staging (OpenNext)

Budget-friendly staging runs on **Cloudflare Workers** via `@opennextjs/cloudflare` (full-stack Next.js — not a static Pages export).

**Worker name:** `bfa-sms-staging` (see `wrangler.jsonc`).

### Prerequisites

- Node.js 20+
- Separate **staging** Supabase project (no real student data)
- All migrations applied on that project in order
- Public email signup **OFF** in Supabase Auth
- Wrangler ≥ 4.59.2 (installed as a devDependency; required for Next.js 16.1+)

### Environment variables

| Variable | Kind | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Staging project URL (build + runtime) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Staging anon key (build + runtime) |
| `NEXT_PUBLIC_SITE_URL` | Public | Public app origin for Auth email redirects (no trailing slash). Staging: `https://bfa-sms-staging.nasalifya007.workers.dev`. Local: `http://localhost:3000`. Must **not** be localhost when building/deploying the Worker. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Staging service role only; Cloudflare Secret; never `NEXT_PUBLIC_` |

Also configure Supabase Auth **Site URL** and **Redirect URLs** (see `docs/PASSWORD_RESET_FIX_REPORT.md`).

These values are **not** in `wrangler.jsonc` (so keys stay out of git). Set them here:

1. **Runtime (required):** Cloudflare Dashboard → Workers & Pages → `bfa-sms-staging` → **Settings** → **Variables and Secrets**  
   - Public vars as **Variables**  
   - `SUPABASE_SERVICE_ROLE_KEY` as a **Secret** only  
2. **Build (required for Workers Builds / CI):** same names under **Build** → **Build variables and secrets** (`NEXT_PUBLIC_*` must exist during `next build`)  
3. **Local CLI deploy:** put them in `.env.local` before `npm run deploy` (script uses `--keep-vars` so dashboard secrets are kept)

Local `next dev` continues to use `.env.local`. For Workers preview, copy `.dev.vars.example` → `.dev.vars` (`NEXTJS_ENV=development`); keep Supabase keys in `.env.local`.

### Local commands

```bash
npm run dev       # Next.js in Node (fast iteration)
npm run preview   # OpenNext build + workerd (closest to staging)
npm run deploy    # Build + deploy (only when explicitly approved)
```

Compatibility flags in `wrangler.jsonc`: `nodejs_compat`, `global_fetch_strictly_public`.

**Auth gate file:** use `src/middleware.ts` (Edge), not `src/proxy.ts`. Next.js 16 `proxy.ts` is Node-only and fails OpenNext with `Node.js middleware is not currently supported`.

**Windows:** OpenNext Windows support is limited. If `preview`/`deploy` fails on native Windows, use WSL or Linux CI.

### Supabase Auth redirects (staging)

After the Worker URL exists (`https://bfa-sms-staging.<account>.workers.dev`):

1. Supabase → Authentication → URL Configuration  
2. **Site URL** = the Workers URL  
3. **Redirect URLs** include that origin (and `http://localhost:3000/**` if developing against staging DB)  
4. Confirm public signup remains **OFF**

### Rollback

1. Cloudflare → Workers → `bfa-sms-staging` → roll back or delete the Worker.  
2. Git: return to `v1-stabilization` (or revert deploy commits).  
3. Point Auth Site URL back to localhost if needed.  

Do not point the staging Worker at a production Supabase project.

---

## Known limitations

- No parent portal or SMS notifications.
- No period-by-period (subject) attendance.
- Payments reduce overall balance; not allocated line-by-line in the UI.
- Class-wide “generate charges for whole class” UI may be incomplete even if an RPC exists.
- No dedicated audit-log UI.

---

## Related docs

- [README.md](../README.md) — project overview and quick start  
- [USER_GUIDE.md](USER_GUIDE.md) — staff how-to
