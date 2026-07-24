# Phase 2D.1 — Automated Staging Deployment Report

**Date:** 2026-07-24
**System:** Blessed Faith Academy School Management System
**Release engineer path:** reviewed commit → push `master` → GitHub Actions **Deploy staging**

---

## 1. Executive Summary

Phase 2D.1 Academic Results Engine was released through the existing automated staging pipeline. The first push (`e6110e7`) failed at `supabase db push` due to invalid Postgres `GRANT`/`REVOKE` signatures on default-argument helpers. A same-migration-file hotfix (`5ee2fd4`) was pushed; migrations applied, Phase 2B/2C/2D online verification passed, and the Cloudflare Worker was promoted. Unauthenticated smoke checks confirm login and Results route gating.

## 2. Repository Root

`C:\Users\nasa\Documents\GitHub\blessed-faith-academy`
Remote: `https://github.com/Nasalifya100/blessed-faith-academy.git`

## 3. Source Branch

`master`

## 4. Deployment Branch

`master` (automatic staging/production Worker deploy per `docs/GITHUB_ACTIONS_PIPELINE.md` and `.github/workflows/deploy-staging.yml`)

## 5. Commit SHA

| Role | SHA | Message |
|---|---|---|
| Feature | `e6110e70dad788a57306576ad0b6c597a37de1ee` | `feat(results): add secure academic results engine and snapshots` |
| Hotfix (live) | `5ee2fd46df02a70690b784a00b23ea0b00152993` | `fix(results): correct can_view_* GRANT signatures for Postgres defaults` |

**Live HEAD:** `5ee2fd46df02a70690b784a00b23ea0b00152993`

## 6. Restore Point

No annotated pre-deployment restore tag was created. Repository convention uses tags such as `v1.0-pre-cicd` for major platform milestones, not ordinary feature releases. Rollback path remains Cloudflare Worker version rollback + forward-fix migrations (documented in `docs/FIRST_AUTOMATED_DEPLOYMENT_CHECKLIST.md`).

## 7. Exact Phase 2D.1 Migration Files

1. `supabase/migrations/20260724150000_academic_results_enums_and_tables.sql`
2. `supabase/migrations/20260724150100_academic_results_capabilities.sql`
3. `supabase/migrations/20260724150200_academic_results_rpcs.sql`

Applied by workflow step **Apply pending migrations** (`supabase db push`) after history gate `safe`.

## 8. Automation Workflow File

`.github/workflows/deploy-staging.yml`
Workflow display name: **Deploy staging**

Also: `.github/workflows/ci.yml` (verify-only; no migrate/deploy)

## 9. Workflow Trigger

`push` to `master` (also supports `workflow_dispatch`).
GitHub Environment: `staging`.
Concurrency group: `production-deploy` (`cancel-in-progress: false`).
Supabase project ref (documented): `qaczvlbgsxcrdcdgsfpo` (staging / pre-production).
Worker: `bfa-sms-staging`.

Deploy is gated on: verify success ∧ migrations success/skipped ∧ verification success. Migration failure blocks Cloudflare promote.

## 10. Local Validation Results (pre-commit)

| Check | Result |
|---|---|
| `npm run lint` | Pass (0 errors; existing warnings only) |
| `npm test` | Pass (226) |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `git diff --check` | Pass |
| `node scripts/phase2d-stage1-verify.cjs --offline` | Pass |

## 11. Push Result

| Push | Result |
|---|---|
| `e6110e7` → `origin/master` | Accepted; triggered run **#5** `30125103133` |
| `5ee2fd4` → `origin/master` | Accepted; triggered run **#6** `30125495759` |

Force-push: not used.

## 12. Workflow Jobs and Results

### Run `30125103133` (`e6110e7`) — FAILED

| Job | Result |
|---|---|
| Phase 1 — Repository checks | success |
| Phase 2–3 — Supabase migrations | **failure** (Apply pending migrations) |
| Phase 4 — Staging verification | skipped |
| Phase 5 — Cloudflare deploy | skipped |
| Phase 6 — Summary | success |

Root cause: `GRANT`/`REVOKE` targeted non-existent overload signatures `(uuid)` / `(uuid,uuid)` for functions defined with `DEFAULT` args (actual signatures are `(uuid,uuid)` and `(uuid,uuid,uuid)`).

### Run `30125495759` (`5ee2fd4`) — SUCCESS

| Job | Result | Notes |
|---|---|---|
| Phase 1 — Repository checks | success | lint/test/tsc/build/cf:build |
| Phase 2–3 — Supabase migrations | success | gate safe → `db push` applied pending |
| Phase 4 — Staging verification | success | Phase 2B + 2C + **2D** structural |
| Phase 5 — Cloudflare deploy | success | upload + promote `@100%` |
| Phase 6 — Summary | success | |

URL: https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30125495759

## 13. Supabase Migration Result

Pending Phase 2D.1 migrations applied successfully on the staging Supabase project via automated `supabase db push` after history gate. No reset/repair used. Deploy did not proceed until migrations succeeded.

## 14. Online Phase 2D Verification

Workflow step **Run Phase 2D results structural verification** → `node scripts/phase2d-stage1-verify.cjs` → **success** (post-migration).

## 15. Cloudflare Build Result

- GitHub Actions: OpenNext/`npm run deploy` path succeeded in Phase 5.
- Parallel Cloudflare **Workers Builds** check for commit `5ee2fd4` also reported success.

## 16. Worker Deployment Result

| Field | Value |
|---|---|
| Worker name | `bfa-sms-staging` |
| Staging URL | https://bfa-sms-staging.nasalifya007.workers.dev |
| Promote step | success (`Confirm promoted version id`) |
| Deploy duration (Phase 5) | ~1m 59s |

## 17. Worker Version ID

Cloudflare Workers Builds check for `5ee2fd4` reported:

`21bd7caa-ced6-435e-b2dc-17d2c94bbabf`

(GitHub Actions promote also succeeded; detailed promote log requires authenticated Actions access. Live traffic is served from the Worker after Phase 5 success.)

## 18. Staging URL

https://bfa-sms-staging.nasalifya007.workers.dev/

## 19. Post-Deployment Smoke Tests

| Check | Result |
|---|---|
| App home loads | HTTP 200 / brand present |
| Login page loads | HTTP 200; Sign-in form present |
| `/dashboard/results` unauthenticated | Redirects to login (no Results UI / no Recalculate) |
| `/dashboard/results/students/...` unauthenticated | Redirects to login |
| CSS asset from login | HTTP 200 |
| Authenticated recalculation / role matrix UI | **Not executed in this agent session** (no staging staff credentials used). Covered by CI online verifier + RLS/unit tests; operator should click-through admin/teacher/secretary once. |

Duplicate recalculation is UI-disabled while `useTransition` pending (`RecalculateResultsButton`).

## 20. Role and Security Verification

| Control | Evidence |
|---|---|
| Snapshot DML revoked; SELECT + RLS only | Migration SQL + Phase 2D online verify |
| Teacher term-aware / subject-scoped helpers | Migration helpers + offline/online verifier contracts |
| Recalculate capability-gated | RPC + server action + permissions unit tests |
| Unauthenticated Results routes gated | Live smoke → login |
| Secretary/bursar default denial | Capability defaults + unit tests |

## 21. Warnings

- Node.js 20 deprecation notices on Actions runners (checkout/setup-node/supabase-cli).
- Existing lint warning: unused `UUID_C` in `src/lib/money.test.ts`.
- React Hook Form compiler skip warnings (pre-existing staff/student forms).
- Parallel Cloudflare Workers Builds also builds on push; canonical promote path remains GitHub Actions `npm run deploy`.

## 22. Known Limitations

Unchanged from pre-commit review:

- Roster eligibility is current enrolment, not as-of-exam history.
- `GRADUATED` requires terminal-grade flag (not set in 2D.1 action).
- Subject/term aggregates not fully recomputed in SQL (source marks + exam %/grades validated).
- Term standings visible to any teacher assigned to the class.
- No promotion-policy write UI/RPC yet.
- Manual recalculation only (no auto hooks).

## 23. Failure Recovery Notes

First deploy blocked correctly on migration failure (no Worker promote). Hotfix amended the **unapplied** migration file (safe because `db push` failed before recording success). Do not edit migrations after they are recorded as applied; future defects need forward-fix SQL.

## 24. Production Readiness Recommendation

**Staging gate: PASS.** Next gate: operator authenticated smoke (admin recalculate one class; teacher scoped view; secretary denied), then schedule Phase 2D.2 (report cards/publishing) only after that click-through is signed off.
