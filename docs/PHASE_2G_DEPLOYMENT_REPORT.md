# Phase 2G — Deployment Report

## Release objective

Deploy Phase 2G Operational Hardening to the school’s effective production Worker (`bfa-sms-staging`) using the established automated GitHub Actions pipeline. No database migrations.

## Commits

| Role | SHA | Message |
|---|---|---|
| Prior HEAD | `40242fac240eaa16f8248d295ebdebd7314157eb` | docs(report-cards): record Phase 2D.2 automated staging deployment |
| Feature | `d11a25021ddc71f52505013b6dd15532473c6719` | feat(ops): add Phase 2G operational hardening |
| Hotfix (OpenNext runtime) | `aa7cd05812478d3901ff9934d956e8c714956525` | fix(ops): use Worker-compatible runtime for health endpoint |
| Hotfix (metadata embed) | `80b35c352de8852013bd77689f1a7d1a3f0b78ae` | fix(ops): embed deployment metadata at OpenNext build time |

**Deployed release commit (live):** `80b35c352de8852013bd77689f1a7d1a3f0b78ae`

## Branch / remote

- Branch: `master`
- Remote: `https://github.com/Nasalifya100/blessed-faith-academy.git`

## Environment classification

- Worker name: `bfa-sms-staging`
- URL: https://bfa-sms-staging.nasalifya007.workers.dev
- Classification: **effective production** (staging-named stack carrying live school operations)
- No separate production Worker/Supabase project

## GitHub Actions

### Run #10 (feature commit) — FAILED

- URL: https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30617726411
- Commit: `d11a250…`
- Started: 2026-07-31T08:50:31Z
- Completed: 2026-07-31T08:53:35Z
- Result: **failure**
- Failed step: Phase 1 — Cloudflare / OpenNext build
- Cause: `app/api/health/route` declared `runtime = "edge"`, unsupported by OpenNext Cloudflare bundling

### Run #11 (runtime hotfix) — SUCCESS

- URL: https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30618863437
- Commit: `aa7cd05…`
- Started: 2026-07-31T09:09:05Z
- Completed: 2026-07-31T09:15:54Z
- Result: **success**
- Migrations job: success (no pending Phase 2G migrations; gate + apply step completed as no-op/safe)
- Verifiers 2B / 2C / 2D.1 / 2D.2: success
- Cloudflare upload + promote: success

### Run #12 (metadata embed hotfix) — SUCCESS (live)

- URL: https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30619779600
- Commit: `80b35c3…`
- Started: 2026-07-31T09:23:52Z
- Completed: 2026-07-31T09:31:11Z
- Result: **success**
- Full verify → migration gate → academic verifiers → Worker promote

## Local validation (pre-feature commit)

- `npm run lint` — pass (pre-existing warnings only)
- `npm test` — 276 then 277/278 after hotfixes
- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `production-preflight --offline` — pass
- `operational-integrity-verify --offline` — pass
- `phase2g-ops-verify` — pass
- `git diff --check` — pass
- Local `npm run cf:build` after runtime hotfix — pass

## Migrations

- Phase 2G introduced **zero** SQL migrations
- Remote migration gate succeeded; no unexpected pending Phase 2G schema changes
- No migration history repair performed

## Verification chain (Actions + post-deploy)

| Check | Result |
|---|---|
| Phase 2B staging verify (Actions) | Pass |
| Phase 2C gradebook structural (Actions) | Pass |
| Phase 2D.1 results structural (Actions) | Pass |
| Phase 2D.2 report cards structural (Actions) | Pass |
| Phase 2G ops verify (local post-push) | Pass |
| Production preflight offline (local) | Pass |
| Operational integrity online read-only (local) | Pass (counts only; no names/amounts) |

Online integrity probe counts (safe): schools=1, students=107, enrolments=107, payments=0, exam_gradebooks=0, result snapshots=0, report cards=0, academic audits=166, finance audits=2.

## Deployment metadata (live)

`GET /api/health` after run #12:

```json
{
  "status": "ok",
  "applicationVersion": "0.1.0",
  "environment": "effective-production",
  "commit": "80b35c352de8"
}
```

Commit short SHA matches deployed release `80b35c3…`.

## Public smoke

| Route | Result |
|---|---|
| `/api/health` | 200 — minimal JSON; no secrets/SQL/project refs |
| `/login` | 200 — sign-in UI |
| `/` | Reachable (intermittent network blips observed from agent network) |
| `/dashboard` | Redirect/deny when unauthenticated |
| `/dashboard/settings/system-health` | 307 → login (admin gate intact) |
| `/dashboard/settings/audit-log` | 307 → login (auth gate intact) |

No stack traces or database internals observed in public responses.

## Authenticated operational smoke

**Pending** — no approved Administrator staff credentials were available to the agent (only infrastructure keys in local env). Operator should confirm System Health + Audit Log in-browser after login.

## Regression smoke

- Automated academic verifiers (2B–2D.2) passed on the live DB after deploy
- Phase 2G did not change calculation engines (2C marks / 2D.1 results / 2D.2 snapshot consumption)
- Public auth gates still redirect protected ops pages

## Cloudflare Worker

- Worker updated: `bfa-sms-staging`
- No new Worker created
- Domain/routes unchanged
- Secrets not modified by this release
- Exact Worker Version UUID: recorded in Actions job “Confirm promoted version id” (requires authenticated log access); promote step succeeded on runs #11 and #12

## Known limitations

- Rate limits remain isolate-local and fail-open
- Backup status remains **Unknown** until Dashboard confirmation
- Legacy actions not fully migrated to `normalizeOpsError`
- Staging/production naming still not separated
- Authenticated ops UI smoke pending operator credentials
- Docs-only follow-up commit may retrigger Deploy staging (no docs-only skip in workflow)

## Rollback decision

**No rollback required.**

Safe rollback path if later needed (operator approval): promote the previous known-good Workers version via Cloudflare dashboard / established `wrangler versions deploy <prior-id>@100%` procedure for `bfa-sms-staging`. Do not reset the database.

## Final release verdict

Phase 2G operational hardening is live on `bfa-sms-staging` at commit `80b35c3…` after OpenNext runtime and metadata embed hotfixes. Public health and automated verification chain succeeded. Authenticated UI smoke remains operator-owned.
