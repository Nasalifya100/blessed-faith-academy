# Phase 2C Stage 1 — Verification Notes

**Date:** 2026-07-24 (updated after verification hotfix)
**Scope:** Database foundation, capabilities, RPCs, TypeScript contracts  
**Production mutations from this stage:** None required to validate unit tests  

---

## Verification tiers

| Tier | Mode | Command / trigger | Mutates data? |
|---|---|---|---|
| 1. Offline/static | Migration SQL contracts for public RPCs + helpers | `node scripts/phase2c-stage1-verify.cjs --offline` | No |
| 2. Online public RPC resolution | Correctly shaped PostgREST probes with synthetic UUID | `node scripts/phase2c-stage1-verify.cjs` (CI default) | No (service role hits `auth.uid() IS NULL` before writes) |
| 3. Optional behavioural smoke | Disposable Auth fixtures | `PHASE2C_SMOKE_FIXTURES=…` or `--require-smoke` | Yes — fixtures only |

CI deploy gate runs **tier 1 + tier 2** only (no fixtures).

---

## Final decisions (security review)

| Topic | Decision |
|---|---|
| Uniqueness | `unique (gradebook_id, student_id)` only. Submit/save reject if another **SUBMITTED/LOCKED** gradebook already holds that exam+student. |
| Roster | **Current** active enrolment + enrolled student − exclusions (not as-of exam date). Documented limitation. |
| Save semantics | **Partial upsert** of payload rows; omitted eligible students unchanged. On save/submit, prune results for students **no longer eligible** only. |
| State machine | `DRAFT→SUBMITTED`; `SUBMITTED→REOPENED`; `SUBMITTED→LOCKED`; `REOPENED→SUBMITTED`. **LOCKED has no outgoing transition in Stage 1.** |
| Secretary/bursar | **No** default `GRADEBOOK_VIEW_ALL` (marks are sensitive). Explicit `academic_capabilities` grant only if school policy requires. |
| Lifecycle | Marks create/edit on **COMPLETED** exams only; optional `MARKS_ENTRY` window. Existing gradebooks remain readable after window closes. REOPENED edits/resubmits allowed after window close only with `GRADEBOOK_REOPEN`. |
| Correction RPC | Deferred; capability exists; no direct write path. |
| Roster prune | Draft save + submit remove ineligible draft rows (audited on submit via `pruned_ineligible_count`). Submitted/locked results never pruned by roster change. |
| Read-by-ID | `get_exam_gradebook(p_gradebook_id)` — never creates; same payload shape as open. |
| Reopen / lock | Both require `p_expected_revision` (added in integrated review). |

---

## Public RPC structural method

Probe each granted RPC with **exact named parameters** and the fixed synthetic UUID `00000000-0000-4000-8000-0000000000c2` (empty `p_rows` where required).

| Outcome | Result |
|---|---|
| Auth required / not-found / unauthorized / validation business error | **PASS** — function resolved |
| PostgREST reports no matching name+signature (`PGRST202` / could not find with supplied args) | **FAIL** |
| Schema-cache reload / network transient | **FAIL** (not confirmed presence) |
| Empty `{}` arity mismatch (“without parameters”) | **Invalid probe** — never used online; classifiers treat it as arity mismatch, not universal absence |

## Internal helper method

Helpers are verified **statically** from migrations (SECURITY DEFINER, `search_path`, revoke/grant text).
Revoked helpers are **not** treated as missing when PostgREST hides them from anon/authenticated.
Online: anon client probes confirm EXECUTE is not available (`permission denied` or schema-cache hide).
`can_read_exam_gradebook` remains granted to `authenticated` (RLS helper) — static grant is checked; anon may not see it.

No `pg_proc` catalogue queries: CI has only the Supabase JS client and no approved generic SQL RPC.

---

## What can be verified without applying migrations

| Suite | Command | Covers |
|---|---|---|
| Permissions + Zod + Stage 2 | `npm test` | Least privilege, XOR rules, entry logic, recovery |
| Verifier classification | `npm test` (`scripts/phase2c-stage1-verify.test.ts`) | Error taxonomy |
| Offline structure | `node scripts/phase2c-stage1-verify.cjs --offline` | Migration contracts |
| Lint / types / build | `npm run lint`, `npx tsc --noEmit`, `npm run build` | Compiles |

## Post-migration smoke (controlled staging only)

After CI/`db push` applies the three migrations (never `db reset`):

```bash
node scripts/phase2c-stage1-verify.cjs
```

Structure probes only by default. Full behavioural matrix needs disposable Auth fixtures.

Set `PHASE2C_SMOKE_FIXTURES` JSON for the behavioural matrix; without fixtures the probe skips smoke safely.

Do not run against production from an agent session without an explicit ops window.

---

## Incident (2026-07-24)

Empty-argument PostgREST probing (`admin.rpc(name, {})`) falsely failed deploy after migrations applied. See `docs/PHASE_2C_DEPLOYMENT_VERIFICATION_INCIDENT.md`. **Hotfix is code-only — no migrations.**
