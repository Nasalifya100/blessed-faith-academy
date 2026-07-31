# Phase 2G — Production Readiness

## Verdict posture

The academic workflow (through Phase 2D.2) is already live on `bfa-sms-staging`. Phase 2G adds operational safety rails. Full production maturity still depends on operator-confirmed backups and a planned deploy of these hardening changes.

## Architecture reality

- **One** Cloudflare Worker: `bfa-sms-staging`
- **One** Supabase project in CI
- GitHub Environment name: `staging`
- Effective classification: **live school production**

## Monitoring plan (current stack only)

| Signal | Where visible | Threshold | Owner | Severity | Response |
|---|---|---|---|---|---|
| Worker exceptions | Cloudflare Observability | Spike vs baseline / any 5xx burst | Technical admin | High | Check deploy SHA; roll back Worker version if new |
| Deploy failures | GitHub Actions | Any failed `Deploy staging` on master | Technical admin | High | Playbook: Worker deployment fails |
| Health shallow fail | `/api/health` | Non-200 or missing version | Technical admin | High | Dependency/outage triage |
| Deep health Action required | System Health page | Any Unavailable on DB | Technical admin | High | Supabase status + RLS/migration checks |
| Auth anomalies | `password_reset_audits` / Audit log | Unexpected reset volume | Administrator | High | Suspected unauthorized access playbook |
| Report/publish failures | `report_card_events` | Fail burst during exam week | Headteacher + admin | High | Report card playbooks |
| Result recalc failures | academic audits / UI refs | Repeated INTERNAL/DEPENDENCY | Academic lead | Medium | Recalc playbook |
| Rate-limit events | Worker logs (`RATE_LIMITED`) | Sustained blocks | Technical admin | Medium | Confirm abuse vs legitimate bulk |
| Migration gate fail | Actions migrations job | Any fail | Technical admin | Blocker | Halt; do not push past gate |

No paid third-party APM is required for this phase.

## Performance findings

- Hot tables generally indexed by prior migrations (students, payments, attendance, gradebooks, snapshots, report cards, audits).
- Student directory previously loaded the full filtered set into the Worker; Phase 2G adds a hard `MAX_LIST_ROWS` (2000) cap.
- Gradebook/results queries already use bounded `.limit` values; class-scoped report-card loads remain acceptable for small schools but may need server pagination as cohorts grow.
- Long operations (class report generation, recalc) must stay chunked; Cloudflare CPU/time limits apply. Queue support is a future candidate if exam-week timeouts appear.
- Do not run heavy `EXPLAIN` against live.

## Data-integrity verification

- Offline: `node scripts/operational-integrity-verify.cjs --offline`
- Online read-only: same script with `--online` + service role (counts only; no names/amounts)

## Migration safety

- Use `node scripts/production-preflight.cjs --offline` before any cutover.
- Online mode may list migrations but **never applies** them.
- Live history repair remains forbidden without a dedicated approved change.

## Release criteria checklist

- [x] Health + system health + audit UI implemented
- [x] Deployment metadata helpers + CI env wiring
- [x] Error/log helpers + tests
- [x] Preflight + integrity + phase2g scripts
- [x] Security/backup/incident docs
- [ ] Operator confirms Supabase backup/PITR in Dashboard
- [ ] Approved deploy of Phase 2G code to Worker
- [ ] Post-deploy smoke: `/api/health`, System Health, Audit log

## Go / No-go

**Conditional GO for operational hardening code merge/deploy when approved:** the controls are additive and low-risk.

**NO-GO for claiming “backups verified” or “dual production/staging isolation”** until Dashboard evidence and/or a disposable restore drill complete.

## Known limitations

- Rate limits are isolate-local and fail open if the store errors.
- Deployment metadata shows `unknown` until a build that injects `NEXT_PUBLIC_GIT_SHA` is deployed.
- Backup tile remains Unknown by design until operators confirm.
- Not all legacy server actions yet use `normalizeOpsError`.
