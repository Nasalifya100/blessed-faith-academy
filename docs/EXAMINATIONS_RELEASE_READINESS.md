# Examinations Release Readiness

## Recommendation

**READY FOR FINAL COMMIT REVIEW** (audit + Command Centre local).
**Not** ready to claim authenticated smoke passed.
**Not** ready to deploy until operator smoke is signed off.

## Preconditions before commit

1. Human review of the combined local diff (no deploy).
2. Confirm `docs/PHASE_2D2_AUTHENTICATED_STAGING_SMOKE.md` remains **excluded**.
3. Operator runs role smoke checklist in `EXAMINATIONS_ROLE_TEST_MATRIX.md` before deploy.
4. Optional later (explicit approval only): `node scripts/examinations-integrity-verify.cjs --online`.
5. Do **not** run Phase 2B against effective production if it creates disposable users.

## What is included

- Role-aware Examinations Command Centre (progress, attention, readiness guidance, class/teacher views)
- Staff-facing terminology and cross-module context links
- Period CLOSED → Closed; archived periods hidden on home list
- Examinations integrity verifier (offline + optional online read-only)
- Audit documentation and refined smoke checklist
- Pre-commit fixes for teacher Calculate/Approve misleading actions and unsafe not-started counts

## Command Centre limits

- Readiness % is guidance only — never an action gate
- No automatic calculate / approve / publish
- Teachers never see school-wide restricted totals
- No student names or marks on the overview

## What is not included / not claimed

- Commit / push / deploy (not done in this review)
- Applied migrations
- Phase 2B online verification against effective production
- Online integrity verification against effective production
- Authenticated smoke pass
- Cancel-exam lifecycle, medical mark enum, consolidated settings, full mobile gradebook redesign

## Residual risks

| Risk | Mitigation |
|---|---|
| Authenticated UI regressions | Operator smoke before deploy |
| Exam-level “no gradebook yet” count (admins only) | Informational; not marks authority |
| Policy pages still split across Academics settings | Deferred consolidation |
| Live effective-production is staging-named Worker | Keep change control strict |

## Validation (local)

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run cf:build`
- Phase 2C / 2D.1 / 2D.2 / 2G offline verifiers
- `node scripts/examinations-integrity-verify.cjs --offline`
- `git diff --check`

Skipped by design against effective production:

- Phase 2B (disposable-user operations)
- examinations-integrity `--online` (service-role; requires explicit approval)
