# Examinations Release — Deployment Report

## Release purpose

Deploy the combined Examinations audit, UX simplification, and Examination Command Centre to the school’s effective production Worker (`bfa-sms-staging`). Presentation and navigation only for readiness guidance; no second results engine; no new migrations; no new lifecycle features.

## Repository base

| Item | Value |
|---|---|
| Canonical repo | `C:\Users\nasa\Documents\GitHub\blessed-faith-academy` |
| Branch | `master` |
| Remote | `https://github.com/Nasalifya100/blessed-faith-academy.git` |
| Prior HEAD / origin/master | `2da59e4f7748c24cc7fa730b69b94f9d4876ec57` (`docs(ops): record Phase 2G deployment`) |

## Commits

| Role | SHA | Message |
|---|---|---|
| Feature | `41392bc8e3246f3c06b992abba00770a45ff1f20` | `feat(examinations): simplify workflows and add command centre` |
| Hotfix | none | — |
| Documentation (this report) | *(this commit)* | `docs(examinations): record examinations release` |

**Deployed application commit (live):** `41392bc8e3246f3c06b992abba00770a45ff1f20`

## Files included (feature commit)

29 files, **+4010 / −87**:

- Docs: `EXAMINATIONS_FULL_AUDIT`, `EXAMINATIONS_RELEASE_READINESS`, `EXAMINATIONS_ROLE_TEST_MATRIX`, `EXAMINATIONS_UX_SIMPLIFICATION`, `EXAMINATIONS_WORKFLOW_MAP`
- `package.json` (`examinations:verify` script)
- `scripts/examinations-integrity-verify.cjs`
- Examinations routes/pages, overview, Command Centre helpers/UI/tests, context links, queries, schemas
- Gradebook hub/workspace/errors (UX / navigation)
- Results dashboard + action copy (UX)
- Report-card dashboard/document/types/actions (UX / print presentation)
- Settings report-cards page copy

## Explicitly excluded

- `docs/PHASE_2D2_AUTHENTICATED_STAGING_SMOKE.md` — remains **untracked**; not part of any release commit
- `.env*` / secrets
- `.next` / `.open-next` / build artifacts
- `src/lib/ops/build-info.generated.ts` (build-time only; not committed)
- Migrations (`supabase/migrations/*` unchanged)

## Validation results (pre-commit / local)

| Check | Result |
|---|---|
| `npm run lint` | Pass (warnings only; no errors) |
| `npm test` | **303** passed |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `npm run cf:build` | Pass |
| Phase 2C offline | Pass (Actions + local structural) |
| Phase 2D.1 offline | Pass (Actions + local structural) |
| Phase 2D.2 offline | Pass (Actions + local structural) |
| Phase 2G ops verify | Pass |
| `examinations-integrity-verify --offline` | Pass (56 checks, 0 fails) |
| `git diff --check` / staged `--check` | Pass (trailing whitespace stripped in two docs before commit) |
| Phase 2B against live DB | Not run from agent (disposable-user risk); **passed in Actions** |
| Examinations integrity `--online` | Not run (requires explicit service-role approval) |

## Release boundary (preserved)

- Authority chain: academic config → examination setup → gradebook marks → result snapshots → immutable report-card payloads
- No second results engine; no client-authoritative marks/totals
- No new snapshot mutation path; no report-card mark recalculation
- Readiness scores are presentation-only; not passed into Calculate / Approve / Publish
- No capability or RLS weakening; no service-role dependency in examinations UI
- Command Centre: no student names, marks, fingerprints, or internal hashes in staff UI
- Role-aware counts and next actions; hidden UI is not treated as authorization
- Context links preserve validated year/term/exam/class values
- Overview/Command Centre queries remain capability-bounded (no unrestricted school-wide teacher/secretary/bursar counts)

## GitHub Actions

### Deploy staging run #14 — SUCCESS

| Field | Value |
|---|---|
| Run number | **14** |
| Run ID | `30626497528` |
| URL | https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30626497528 |
| Commit | `41392bc8e3246f3c06b992abba00770a45ff1f20` |
| Event | `push` to `master` |
| Started | `2026-07-31T11:17:14Z` |
| Completed | `2026-07-31T11:23:50Z` |
| Conclusion | **success** |

| Job | Result |
|---|---|
| Phase 1 — Repository checks (lint/test/tsc/build/cf:build) | success |
| Phase 2–3 — Supabase migrations (list, gate, apply) | success |
| Phase 4 — Staging verification (2B, 2C, 2D.1, 2D.2) | success |
| Phase 5 — Cloudflare deploy (upload + promote 100%) | success |
| Phase 6 — Summary | success |

## Migration verification

- Examinations feature commit contains **zero** migration files
- Migration gate + apply completed successfully on run #14
- No unexpected new examination migration; apply behaves as safe no-op / previously approved pending only
- No database reset; no migration-history repair; no production academic data rewritten by a new examination migration

## Worker and URL

| Item | Value |
|---|---|
| Worker | `bfa-sms-staging` (unchanged; no new Worker) |
| URL | https://bfa-sms-staging.nasalifya007.workers.dev |
| Domain/routes | Unchanged |
| Secrets | Not added or modified by this release |
| Promoted version UUID | Recorded in Actions step “Confirm promoted version id” (authenticated log access); promote step succeeded |
| Prior version | Remains available for rollback; not required |

## Deployment metadata (live)

`GET /api/health` after run #14:

```json
{
  "status": "ok",
  "timestamp": "2026-07-31T11:28:05.711Z",
  "applicationVersion": "0.1.0",
  "environment": "effective-production",
  "commit": "41392bc8e324"
}
```

Commit short SHA matches feature commit `41392bc…`.

## Public smoke

| Route | Result |
|---|---|
| `/api/health` | **200** — minimal JSON above; no secrets/SQL/project refs |
| `/login` | **200** — sign-in UI |
| `/dashboard/examinations` | **307** → `/login` |
| `/dashboard/gradebook` | **307** → `/login` |
| `/dashboard/results` | **307** → `/login` |
| `/dashboard/report-cards` | **307** → `/login` |
| `/dashboard/settings/system-health` | **307** → `/login` |

No stack traces, OpenNext chunk failures, hashes, service keys, or database internals observed in public responses. Intermittent agent-network timeouts occurred; successful probes confirm the Worker is healthy.

## Authenticated examinations smoke

**Pending — operator-owned.**

No approved staff role credentials were available to the agent. Do not treat this as a pass.

Operator checklist (from `docs/EXAMINATIONS_ROLE_TEST_MATRIX.md`):

- **Administrator/headteacher:** Command Centre loads; year/term/exam context accurate; readiness/blockers accurate; class table bounded; attention links correct; Calculate/Approve/Publish only when capability permits; viewing does not mutate records
- **Teacher:** assigned work only; no school-wide restricted counts; marks workspace; blank/zero/ABSENT/EXEMPT/NOT_ASSESSED distinct; no Calculate/Approve
- **Secretary:** schedule-only / access-appropriate; direct marks/results/report-card access denied
- **Bursar:** no marks/results/readiness/report-card authority; restricted URLs denied

## Academic regression verification

| Check | Result |
|---|---|
| Phase 2C (Actions + local offline) | Pass |
| Phase 2D.1 (Actions + local offline) | Pass |
| Phase 2D.2 (Actions + local offline) | Pass |
| Phase 2G (local) | Pass |
| Examinations integrity offline | Pass |
| Calculation engine unexpected change | None intended; Actions academic verifiers passed |
| Permission / capability regression | Not observed in code review or CI |
| Report-card immutable payload behavior | Unchanged by design (UX/copy/presentation only) |

Destructive online academic tests were not performed.

## Known limitations

- Authenticated role UX smoke remains **unconfirmed** until operator sign-off
- Examinations integrity `--online` not run (needs explicit service-role approval)
- Staging-named Worker remains effective production (no separate production stack)
- Docs-only follow-up commit retriggers Deploy staging (no docs-only skip)

## Deferred items

- Whole-system audit (explicitly not started)
- Parent portal, transcripts, promotion execution, backup automation
- New examination lifecycle features beyond this release

## Rollback decision

**No rollback required.**

Public health matches `41392bc…`, auth gates redirect protected examination routes, CI academic verifiers passed, Cloudflare promote succeeded. Pending authenticated smoke alone does not require rollback but remains a documented operational limitation.

Safe rollback if later needed (operator approval): promote the immediately prior known-good Worker version for `bfa-sms-staging`. Do **not** reset the database or rewrite migration history.

## Final readiness verdict

Examinations audit + Command Centre is **deployed successfully** on `bfa-sms-staging` at commit `41392bc…`. Public deployment and automated verification chain are healthy. Authenticated multi-role UX confirmation remains operator-owned before claiming full operational sign-off.
