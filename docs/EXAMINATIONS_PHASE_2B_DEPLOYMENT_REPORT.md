# Examinations Phase 2B — Deployment Report

**System:** Blessed Faith Academy School Management System  
**Phase:** 2B.1 — Examination setup polish, references, status workflow and deployment  
**Report date:** 2026-07-23  
**Verdict:** PHASE 2B EXAMINATION SETUP DEPLOYMENT BLOCKED

---

## Why blocked

Staging already has Phase 2B **base** objects (`exam_rooms`, `exam_periods`, `exams`, schedules, templates), but the polish migration is **not fully applied**:

| Object | Staging state |
|---|---|
| `exam_rooms` / `exam_periods` / `exams` | Present (migrations 300–302 applied) |
| `exam_reference_counters` | Present (partial / early 303) |
| `exams.exam_reference` | **Missing** |
| `exams.status` (lifecycle) | **Missing** |
| `transition_exam_status` | **Missing** |

Local `.env.local` has **no** `DATABASE_URL` / `SUPABASE_DB_URL` / `POSTGRES_URL` and no Supabase CLI access token, so DDL cannot be applied from this agent environment (project standard is **Supabase SQL Editor**).

Controlled workflow verification and Cloudflare deploy were **stopped** so the app is not shipped against a schema that cannot serve Exam reference / status fields.

---

## Implementation identity (code ready)

| Field | Value |
|---|---|
| Branch | `master` |
| Implementation commit | `bd6094b` |
| Supabase project | `blessed-faith-academy` |
| Project ref | `qaczvlbgsxcrdcdgsfpo` |
| Worker target | `bfa-sms-staging` |
| URL | https://bfa-sms-staging.nasalifya007.workers.dev |
| Deployed in this task | **No** (blocked) |

---

## Migrations

| # | File | Staging |
|---|---|---|
| 1 | `20260723130000_exam_rooms_and_capabilities.sql` | Applied |
| 2 | `20260723130100_exam_periods_exams_schedules.sql` | Applied |
| 3 | `20260723130200_exam_setup_rpcs.sql` | Applied |
| 4 | `20260723130300_exam_references_and_status_workflow.sql` | **Not complete — apply in SQL Editor** |

Migration 4 is additive and idempotent (`if not exists` / `create or replace`). Re-run the **full file** safely.

### Unblock steps

1. Open Supabase → project **blessed-faith-academy** (`qaczvlbgsxcrdcdgsfpo`) → SQL Editor.  
2. Paste and run the full contents of `20260723130300_exam_references_and_status_workflow.sql`.  
3. Confirm: `exams.exam_reference`, `exams.status`, RPCs `allocate_exam_reference`, `transition_exam_status`.  
4. Run `node scripts/phase2b-staging-verify.cjs all`.  
5. Commit/push if needed, then `npm run deploy` to `bfa-sms-staging`.  
6. Live UI check + cleanup Exam Verify rows.

Optional: add `DATABASE_URL` to `.env.local` (never commit) so `node scripts/apply-phase2b-migrations.cjs` can apply DDL next time.

---

## Exam reference format

`EX-{YEAR}-{TERM_CODE}-{SEQ4}`

Examples: `EX-2026-T2-0001`, `EX-2026-TY-0001`

- Scope: school + academic year + term code  
- Counter table: `exam_reference_counters` with upsert increment (no `MAX+1`)  
- Unique per school; immutable; never copied on template/period duplicate  

---

## Status workflow

Draft → Scheduled → Ready → Completed → Archived  

Explicit action buttons; blockers list missing room/invigilator/schedule; reason required for backward moves from Ready+.

Exam **period** statuses remain Draft / Open / Completed (`CLOSED`) / Archived.

---

## Repository checks (this task)

| Command | Result |
|---|---|
| `npm run lint` | Passed (0 errors; 4 pre-existing warnings) |
| `npm test` | **124** passed |
| `npm run build` | Passed (examinations routes present) |
| `npm run cf:build` | Passed |

---

## Security / verification / cleanup

| Item | Result |
|---|---|
| Controlled full verify | **Not completed** (blocked on migration 303) |
| Teacher read-only / unauthorized RPC | Pending post-303 verify script |
| Partial Exam Verify rows | **Removed** via `scripts/phase2b-cleanup-partial.cjs` |
| Seeded assessment types / genuine data | Untouched |

---

## Known limitations

- Marks entry not implemented (Phase 2C).  
- No local database URL for automated DDL.  
- Deploy withheld until polish schema is live.

---

## Readiness for Phase 2C

**Not ready.** Finish migration 303 apply + verify + deploy first, then Phase 2C Teacher Gradebook.

---

PHASE 2B EXAMINATION SETUP DEPLOYMENT BLOCKED
