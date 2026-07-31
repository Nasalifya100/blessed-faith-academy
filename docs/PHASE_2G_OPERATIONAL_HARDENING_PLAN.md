# Phase 2G — Operational Hardening Plan

**Repository:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`  
**Live Worker:** `bfa-sms-staging` → https://bfa-sms-staging.nasalifya007.workers.dev  
**Constraint:** This phase does not add parent portal, transcripts, promotion execution, messaging, or new academic calculation logic.

## Actual architecture (verified)

| Layer | Reality |
|---|---|
| App | Next.js 16 + OpenNext on Cloudflare Workers |
| Worker | Single Worker `bfa-sms-staging` (named staging, used as live school production) |
| Database | Single Supabase project (CI `SUPABASE_PROJECT_REF`) |
| Auth | Supabase Auth + Edge middleware (`src/middleware.ts`) |
| Authorization | RLS + SECURITY DEFINER RPCs + role/capability helpers |
| Deploy | `.github/workflows/deploy-staging.yml` on push to `master` |
| CI | `.github/workflows/ci.yml` (lint/test/build/cf:build, no deploy) |

There is **no** separate production Worker workflow or second Supabase project in the pipeline.

## Environment classification recommendation

**Recommendation A — Keep the current environment as effective production, formally treat and harden it.**

Rationale:

- Real school workflows (finance, attendance, gradebook, results, report cards) already run here.
- Renaming/migrating without an approved cutover risks downtime and auth redirect breakage.
- Hardening (health, audit UI, preflight, incident playbooks, metadata) delivers safety without a risky move.

**Do not** rename the Worker, move the database, or change domains in this phase without explicit approval.

A future **Recommendation B** (true dual environments) remains valid once disposable staging exists and a controlled promotion path is funded.

## Threat model summary

See `PHASE_2G_SECURITY_REVIEW.md` for full classifications. Highest operational priorities:

1. Staging-named live stack (operator confusion) — High
2. Missing health / release identity during incidents — High (mitigated this phase)
3. Unbounded list loads as enrolment grows — Medium (student list capped)
4. No app-level rate limits on costly admin actions — Medium (password reset limited)
5. Backup success not verified by application — High (documented; Unknown until confirmed)
6. Audit streams without admin review UI — Medium (UI added)
7. Raw error leakage in some server actions — Medium (shared normalizer added; gradual adoption)

## Implemented controls (this phase)

- Public `/api/health` (shallow, redacted)
- Admin `/dashboard/settings/system-health`
- Admin/headteacher `/dashboard/settings/audit-log` (read-only)
- Deployment metadata helpers + CI build env wiring
- Structured Workers-safe logger + normalized ops errors
- Best-effort in-isolate rate limits sized for school exam-week throughput
  (password reset, result recalc, report-card bulk generate; fail-open)
- Student list hard cap (`MAX_LIST_ROWS`)
- Upload policy helpers (no live upload pipeline yet)
- `scripts/production-preflight.cjs`
- `scripts/operational-integrity-verify.cjs`
- `scripts/phase2g-ops-verify.cjs`
- Incident / backup / security / readiness docs

## Explicit non-goals

- Live restore drills against production
- Creating a second Cloudflare/Supabase production stack
- Background job queues
- Paid third-party APM
- Schema rewrites or destructive migrations

## Release criteria for declaring Phase 2G complete (code)

1. Offline preflight + integrity + phase2g verify pass
2. Lint, unit tests, `tsc`, build pass
3. Docs present and consistent with staging-as-production reality
4. No commit/push/deploy required to finish the phase coding gate

Go-live of the new UI still requires a later approved deploy (out of scope for this task’s execution).
