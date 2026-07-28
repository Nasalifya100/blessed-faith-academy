# Phase 2D.2 — Automated Staging Deployment Report

**Date:** 2026-07-28
**System:** Blessed Faith Academy School Management System
**Release path:** reviewed commit → push `master` → GitHub Actions **Deploy staging**

---

## 1. Release scope

Phase 2D.2 Report Cards and Result Publishing:

- Lifecycle DRAFT → REVIEWED → APPROVED → PUBLISHED (+ UNPUBLISHED / VOIDED)
- Immutable `render_payload` + checksum frozen at approval
- Phase 2D.1 snapshots as sole academic authority
- Stale/fingerprint/gradebook-drift blocking
- Server-side attendance reconstruction
- Remarks, settings, single/bulk A4 print
- RLS + capabilities + revision/row locks + audit
- Offline/online structural verifier + CI gate after Phase 2D.1

## 2. Feature commit

| Field | Value |
|---|---|
| Full SHA | `b22c48eee994f4d3ee2139ed687c1dde0f3cc80e` |
| Short SHA | `b22c48e` |
| Message | `feat(report-cards): add Phase 2D.2 publishing workflow` |
| Files | 27 changed, +6058 lines |
| Corrective commit | none (first apply succeeded) |

## 3. Workflow run

| Field | Value |
|---|---|
| Workflow | Deploy staging |
| Run number | **#8** |
| Run ID | `30341545581` |
| URL | https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30341545581 |
| Trigger | push to `master` |
| Result | **success** |
| Duration | 7m 4s |
| Created | 2026-07-28T08:13:55Z |
| Completed | 2026-07-28T08:20:59Z |

## 4. Migrations expected / applied

Expected pending (exact):

1. `20260728160000_report_cards_enums_and_tables.sql`
2. `20260728160100_report_cards_capabilities.sql`
3. `20260728160200_report_cards_rpcs.sql`

| Gate | Result |
|---|---|
| Inspect migration list | success |
| Migration history gate | success (`safe`) |
| Apply pending migrations (`supabase db push`) | success |

No reset, repair, or manual `db push` was used.

## 5. Verification gates

| Gate | Result |
|---|---|
| Phase 1 — Repository checks (lint/test/tsc/build/OpenNext) | success |
| Phase 2B staging verification | success |
| Phase 2C gradebook structural verification | success |
| Phase 2D.1 results structural verification | success |
| Phase 2D.2 report cards structural verification | success |

## 6. Application build / Worker upload / promotion

| Gate | Result |
|---|---|
| Next.js build (Phase 1) | success |
| Cloudflare / OpenNext build (Phase 1) | success |
| Phase 5 upload + promote `@100%` | success |
| Confirm promoted version id | success |

| Field | Value |
|---|---|
| Worker name | `bfa-sms-staging` |
| Staging URL | https://bfa-sms-staging.nasalifya007.workers.dev |
| Deployed commit | `b22c48eee994f4d3ee2139ed687c1dde0f3cc80e` |
| Cloudflare Workers Builds check | success — Build ID `04f09545-d254-40fc-a9b9-d08dda04471c` |
| Actions promote Worker version ID | Confirmed written by workflow (`Confirm promoted version id` succeeded). Exact UUID requires authenticated Actions log access. |

## 7. Unauthenticated smoke

| URL | Result |
|---|---|
| `/` | HTTP 307 → `/login` |
| `/login` | HTTP 200 |
| `/dashboard` | HTTP 307 → `/login` |
| `/dashboard/report-cards` | HTTP 307 → `/login` |
| `/dashboard/settings/report-cards` | HTTP 307 → `/login` |
| `/dashboard/report-cards/<fake-uuid>` | HTTP 307 → `/login` (no existence leak) |
| `/dashboard/report-cards/<fake-uuid>/print` | HTTP 307 → `/login` |
| `/dashboard/results` | HTTP 307 → `/login` |
| `/dashboard/gradebook` | HTTP 307 → `/login` |
| `/dashboard/students` | HTTP 307 → `/login` |

No 500s observed. No raw SQL/Postgres details exposed.

## 8. Authenticated smoke

**Pending operator checklist** (no staging staff credentials used in this release session):

### Admin / head

- Report Cards nav visible; settings page opens
- Year/term/class filters + readiness counts
- Missing/stale results block generate/approve
- Generate drafts for one safe staging class
- Save remarks → review → approve (immutable payload) → publish
- Single + bulk print
- Unpublish preserves snapshot/history
- Revision conflict surfaces correctly

### Teacher

- Only assigned classes/students visible
- May edit authorized remarks; cannot approve/publish/settings

### Secretary / bursar

- Denied by default; no Report Cards nav; routes/RPCs denied

## 9. Regression smoke (unauthenticated)

Login and prior module routes (`results`, `gradebook`, `students`) still redirect-protect as before. Phase 2C/2D.1 structural verifiers passed in the same pipeline, so gradebook authority and results snapshot contracts remain intact.

## 10. Defects encountered

None during automated staging apply/deploy. No corrective commits required.

## 11. Known limitations

- Authenticated end-to-end report-card click-through not executed in agent session
- Parent/student portals, email/SMS delivery remain deferred
- Exact Actions-promoted Worker version UUID not readable from public API (promote step confirmed success)

## 12. Rollback reference

Do not reverse additive migrations. If a severe app defect appears: roll Cloudflare Worker traffic to the previous known-good version, then forward-fix via normal commits. Prior Phase 2D.1 live feature SHA for reference: `5ee2fd46df02a70690b784a00b23ea0b00152993`.

## 13. Staging verdict

**Phase 2D.2 deployed successfully to staging** via automated pipeline on commit `b22c48e`, run [#8](https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30341545581).
