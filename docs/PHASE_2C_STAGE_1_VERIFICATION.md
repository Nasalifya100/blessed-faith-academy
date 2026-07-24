# Phase 2C Stage 1 — Verification Notes

**Date:** 2026-07-24 (updated after pre-commit security review)  
**Scope:** Database foundation, capabilities, RPCs, TypeScript contracts  
**Production mutations from this stage:** None required to validate unit tests  

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

## What can be verified without applying migrations

| Suite | Command | Covers |
|---|---|---|
| Permissions + Zod | `npm test` | Least privilege, XOR rules, duplicates, reopen reason, state matrix docs |
| Lint / types / build | `npm run lint`, `npx tsc --noEmit`, `npm run build` | Compiles |

## Post-migration smoke (controlled staging only)

After CI/`db push` applies the three migrations (never `db reset`):

```bash
node scripts/phase2c-stage1-verify.cjs
```

Structure probes only by default. Full behavioural matrix needs disposable Auth fixtures and must assert:

1. Assigned teacher open  
2. Unassigned rejection  
3. Duplicate open idempotency (unique conflict path)  
4. Valid draft save (partial upsert)  
5. Invalid batch atomic reject (negative / over max / NaN / status+mark)  
6. Stale revision conflict  
7. Incomplete submit blocked  
8. Complete submit + roster_snapshot (+ prune of ineligible draft rows; `pruned_ineligible_count` audited)  
9. Submitted edit rejected  
10. Reopen requires capability + reason; LOCKED cannot reopen  
11. Lock from SUBMITTED only  
12. Direct DML denied  
13. Audit events for create/save/submit/reopen/lock  
14. Cross-class submitted conflict for same exam+student (manual / future fixture)  

Set `PHASE2C_SMOKE_FIXTURES` JSON for the behavioural matrix; without fixtures the probe skips smoke safely.

Do not run against production from an agent session without an explicit ops window.

---

## Explicitly not run during Stage 1 authoring / this review

- `supabase db push` against production from the agent  
- `supabase db reset` / `migration repair`  
- Wrangler / `npm run deploy` / push to `master`  
