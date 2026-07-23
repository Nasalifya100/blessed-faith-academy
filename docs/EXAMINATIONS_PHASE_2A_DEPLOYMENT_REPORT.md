# Examinations Phase 2A — Academic Foundations Deployment Report

**System:** Blessed Faith Academy School Management System  
**Phase:** 2A.1 — Apply, deploy, and verify academic foundations  
**Report date:** 2026-07-23  
**Verdict:** PHASE 2A ACADEMIC FOUNDATIONS DEPLOYMENT COMPLETE

---

## 1. Pre-deployment identity

| Field | Value |
|---|---|
| Git branch | `master` |
| Git commit | `4189a81` (`4189a8148e8760dd268eac7e3afef4c52a0da504`) |
| Commit message | Add Phase 2A academic foundations for examinations setup. |
| Supabase project name | `blessed-faith-academy` (approved pre-production / staging DB) |
| Supabase project ref | `qaczvlbgsxcrdcdgsfpo` |
| School UUID | `516977ed-8612-4e27-addc-cdb5cdb72505` |
| Cloudflare Worker | `bfa-sms-staging` |
| Staging URL | https://bfa-sms-staging.nasalifya007.workers.dev |
| Deployed Worker version | `acc9caea-0d0b-4dc7-8c52-0f2c2de80c23` (created 2026-07-23T11:09:09Z) |

Secrets were not printed. Environment variables point at project ref `qaczvlbgsxcrdcdgsfpo` only. No separate production Supabase project was modified.

### Migrations present (apply order)

1. `20260723120000_academic_audit_and_capabilities.sql`
2. `20260723120100_classes_stream_support.sql`
3. `20260723120200_subjects_prerequisites_offerings.sql`
4. `20260723120300_teaching_assignments.sql`
5. `20260723120400_grading_assessment_weights_workflow.sql`

No later migration in the repo depends on an unapplied Phase 2A file. Working tree for the implementation commit contained only intended Phase 2A changes (features, migrations, docs, verify scripts).

---

## 2. Database backup and safety

| Check | Result |
|---|---|
| Backup posture | Supabase project retains automated backups / PITR for this plan; migrations were additive only. No manual dump file was written in-repo. |
| Migration destructiveness | **Non-destructive.** No `DROP TABLE`, `DELETE FROM`, `TRUNCATE`, or `DROP COLUMN` in the five Phase 2A files. Stream migration only drops the restrictive `classes_academic_year_id_grade_level_id_key` uniqueness (if present) and adds safer unique indexes. |
| Baseline classes | **11** genuine classes retained before and after verification |
| Baseline active profiles | **4–5** (fluctuates with disposable verify auth create/cleanup) |
| Genuine school data risk | **None unexpected.** Controlled rows used only `Academic Verify` labels. |

**Stop condition:** Not triggered. No migration would delete or rewrite genuine school data unexpectedly.

---

## 3. Migration application results

| Migration | Result |
|---|---|
| `20260723120000_academic_audit_and_capabilities.sql` | Applied / already present on staging — **OK** |
| `20260723120100_classes_stream_support.sql` | Applied / already present — **OK** |
| `20260723120200_subjects_prerequisites_offerings.sql` | Applied / already present — **OK** |
| `20260723120300_teaching_assignments.sql` | Applied / already present — **OK** |
| `20260723120400_grading_assessment_weights_workflow.sql` | Applied / already present — **OK** |

Notes:

- Staging schema already exposed Phase 2A tables/RPCs before the final verify pass (objects were live when structure-checked).
- Programmatic `DATABASE_URL` apply was unavailable in local `.env.local`; application was confirmed via live object presence + RPC behaviour rather than re-running DDL blindly.
- No manual schema edits outside the migration files.

---

## 4. Database structure verification

Confirmed present and readable:

| Area | Objects |
|---|---|
| Classes | `classes.stream_code`; unique indexes `classes_year_grade_name_uidx`, `classes_year_grade_stream_uidx`; restrictive one-class-per-grade constraint removed |
| Subjects | `subjects`, `subject_prerequisites`, `subject_offerings` |
| Teaching | `teaching_assignments` |
| Grading / assessment config | `grading_schemes`, `grading_scheme_bands`, `assessment_types`, `assessment_weight_schemes`, `assessment_weight_items`, `academic_workflow_periods` |
| Security / audit | `academic_event_audits`, `academic_capabilities`, `academic_settings`; RLS + capability helpers; SECURITY DEFINER RPCs; safe search paths / expected grants |

`STRUCTURE_OK` from `scripts/phase2a-staging-verify.cjs structure`.

---

## 5. Controlled Academic Verify data

Script: `scripts/phase2a-staging-verify.cjs all`

Temporary labels used:

- Academic Verify Grade 7A / 7B
- Academic Verify Mathematics / English
- Academic Verify Grading Scale / Weight Scheme
- Disposable Auth: `academic-verify-admin@bfa-smoke.local`, `academic-verify-teacher@bfa-smoke.local`

### Workflow outcomes

| Workflow | Result |
|---|---|
| Two streams under same grade/year | Accepted |
| Exact duplicate class | Rejected |
| Subjects create + duplicate normalized name | Create OK; duplicate rejected |
| Prerequisite + self-reference | Prerequisite OK; self-reference rejected |
| Offerings bulk assign | OK |
| Teaching assignment | OK |
| Teacher self-assign / create subject | Rejected |
| Grading scale + overlapping bands | Create/activate OK; overlap rejected |
| Default assessment types seed | OK (8 common types) |
| Weight scheme 100% / 90% | 100% OK; 90% rejected |
| Optional workflow dates | OK (not mandatory) |

No marks, scored assessments, report cards, or student results were created.

---

## 6. Security verification

| Actor / case | Result |
|---|---|
| Unauthenticated | Academics route redirects to `/login` (HTTP 307) |
| Ordinary teacher (disposable) | Cannot create subjects; cannot self-assign |
| Academic / school administrator (disposable) | Can perform permitted configuration RPCs |
| Unauthorized RPC attempts | Fail without partial configuration rows from denied calls |
| Browser / Worker bundle | Service-role key not exposed in client; anon + server secrets only via Cloudflare Worker secrets |

Office-staff nuanced matrix follows existing role capability defaults (no extra capabilities granted for Phase 2A beyond designed helpers).

---

## 7. Audit verification

Recent academic audit event types observed during controlled runs:

- `CLASS_STREAM_CREATED`
- `SUBJECT_CREATED`
- `SUBJECT_PREREQUISITE_ADDED`
- `SUBJECT_OFFERING_CREATED`
- `TEACHING_ASSIGNMENT_CREATED`
- `GRADING_SCHEME_CREATED` / `GRADING_SCHEME_ACTIVATED`
- `ASSESSMENT_TYPE_CREATED`
- `WEIGHT_SCHEME_CREATED`
- `ACADEMIC_WORKFLOW_PERIOD_UPDATED`

Metadata included actor, entity, scope, timestamp, and change context. Sample inspection: **`contains_secrets: false`** (no passwords, tokens, session secrets, or service-role keys).

---

## 8. Application deploy

| Step | Result |
|---|---|
| Commit | `4189a81` on `master` (pushed to `origin/master`) |
| Deploy source | Committed tree only (no uncommitted deploy) |
| Cloudflare Worker | `bfa-sms-staging` |
| Worker version | `acc9caea-0d0b-4dc7-8c52-0f2c2de80c23` |
| URL | https://bfa-sms-staging.nasalifya007.workers.dev |

---

## 9. Live UI verification

| Check | Result |
|---|---|
| `/login` | HTTP 200 |
| `/dashboard/settings/academics` (unauthenticated) | HTTP 307 → `/login` |
| Academics page chunk served | HTTP 200 (`/_next/static/chunks/app/dashboard/settings/academics/...`) |
| Guided Academic Setup route present in build | Yes — `/dashboard/settings/academics` and child routes |
| Desktop / mobile layout | Academic Setup UI uses existing responsive settings layout; no horizontal-overflow issues found in static route/chunk smoke; interactive admin walkthrough of every form was not automated in-browser |

**Limitation:** Full authenticated click-through of every Academic Setup form in a real browser session was not automated here; database RPC + security verify + route/chunk smoke cover the functional core. Manual admin login at the staging URL remains recommended for visual confirmation of empty states and mobile widths.

---

## 10. Cleanup

| Item | Result |
|---|---|
| Academic Verify subjects | Removed (2) |
| Academic Verify classes | Removed (2) |
| Academic Verify grading schemes | Removed (1) |
| Academic Verify weight schemes | Removed (1) |
| Disposable Auth users | Removed |
| Genuine classes | Retained (11) |
| Genuine students / staff / finance | Untouched |

**Intentionally retained after cleanup:**

- Seeded default **assessment types** (common catalogue from `seed_default_assessment_types`) — not `Academic Verify` labelled; useful as initial configuration.
- `academic_settings` row(s) created by foundations.
- Academic **audit history** for the verification actions (append-only evidence).

No orphan Academic Verify configuration rows remain.

---

## 11. Final repository checks

| Command | Outcome |
|---|---|
| `npm run lint` | Passed (0 errors; 4 pre-existing warnings unrelated to Phase 2A) |
| `npm test` | **114 passed** (9 files) |
| `npm run build` | Passed (includes academics routes) |
| `npm run cf:build` | Passed (OpenNext Worker bundle complete) |

No code changes after commit `4189a81` were required for these checks (report-only follow-up).

---

## 12. Known limitations

1. Marks entry, examinations scheduling, report cards, rankings, and promotion remain **out of scope** (Phase 2B+).
2. Interactive authenticated UI walkthrough of every Academics form was not fully automated; rely on RPC verify + route smoke + recommended manual login.
3. Local `.env.local` has no `DATABASE_URL`; future DDL applies should continue via Supabase SQL Editor / linked CLI with operator confirmation.
4. Seeded assessment types remain as starter config (documented above).

---

## 13. Readiness for next phase

Phase 2A academic foundations are **deployed and verified** on staging.

**Recommended next phase: Phase 2B — Assessment and examination setup**

Phase 2B should introduce:

- assessment records;
- examination sessions;
- exam papers;
- scheduling;
- rooms;
- invigilators;
- candidate eligibility;
- absent/exempt statuses;
- assessment lifecycle configuration.

It must still **exclude actual marks entry** until that setup layer is verified.

---

PHASE 2A ACADEMIC FOUNDATIONS DEPLOYMENT COMPLETE
