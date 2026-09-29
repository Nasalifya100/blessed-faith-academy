# Finance — Release Readiness

**Date:** 2026-09-29
**Change set:** Finance module upgrade — funds, physical accounts, ledger, expenditure, petty cash, salaries, transfers, reversals, reporting.
**State:** implemented, validated offline, **not committed, not pushed, not deployed, migrations not applied**.

---

## Validation results

Everything below was run locally against this working tree.

| Check | Command | Result |
|---|---|---|
| Unit and invariant tests | `npm test` | **PASS** — 400 passed, 25 files, 0 failed |
| Lint | `npm run lint` | **PASS** — 0 errors, 4 pre-existing warnings |
| Typecheck | `npx tsc --noEmit` | **PASS** |
| Next.js production build | `npm run build` | **PASS** |
| Cloudflare / OpenNext build | `npm run cf:build` | **PASS** — worker bundled |
| Finance integrity verifier | `node scripts/finance-integrity-verify.cjs` | **PASS** — 33/33 static checks |
| Operational integrity verifier | `node scripts/operational-integrity-verify.cjs` | **PASS** — fail=0 warn=0 |
| Examinations integrity verifier | `node scripts/examinations-integrity-verify.cjs` | **PASS** — 56 checks, fail=0 warn=0 |
| Phase 2G ops verifier | `node scripts/phase2g-ops-verify.cjs --offline` | **PASS** |
| Production preflight | `npm run preflight` | **PASS** — fail=0, warn=5 (all shell-env warnings, expected locally) |
| Whitespace | `git diff --check` plus a trailing-whitespace scan of every new file | **PASS** — clean |

The four lint warnings and five preflight warnings are pre-existing and unrelated to this change set: three React Compiler notices about `react-hook-form`'s `watch()`, one unused variable in `money.test.ts`, and five "environment variable not set in this shell" notices.

All nine Finance routes are present in the build manifest:
`/dashboard/finance`, `/funds`, `/funds/[code]`, `/accounts`, `/accounts/[id]`, `/expenses`, `/petty-cash`, `/salaries`, `/transfers`, `/reports`.

## Regression posture

No existing test was modified, skipped, or weakened. The suite grew from 306 to 384 passing tests.

No existing financial control was removed. The verifier actively fails the build if a finance migration drops a trigger or policy on `payments` or `charges`, alters `public.payments`, grants write access to it, or references the existing immutability triggers.

Untouched and verified untouched: `payments`, `charges`, `payment_allocations`, `payment_finance_snapshots`, `record_payment`, `void_payment`, `apply_available_credit`, `cancel_optional_charge`, `get_student_finance_summary`, receipt numbering, and payment idempotency.

## Change control compliance

| Constraint | Status |
|---|---|
| Do not commit | Honoured — working tree is dirty, nothing staged |
| Do not push | Honoured |
| Do not deploy | Honoured |
| Do not apply migrations to the live database | Honoured — no database connection was opened at any point |
| Do not modify Cloudflare DNS or the custom domain | Honoured — `wrangler.jsonc` untouched |
| Do not modify Supabase Auth configuration | Honoured |
| Do not restructure portal routes | Honoured — finance routes added under the existing `/dashboard` tree |
| `docs/PHASE_2D2_AUTHENTICATED_STAGING_SMOKE.md` left alone | Honoured — still untracked, unmodified |
| No service-role credentials in browser code | Honoured and enforced by verifier check `SEC-03` |
| Do not weaken tests | Honoured |

## What an operator must do before this is useful

In order:

1. **Review the five migration files** as a change set. They are the highest-risk part of this work.
2. **Apply to staging first.** Never straight to production.
3. **Confirm no balance moved.** Sample a dozen pupils and check `get_student_finance_summary` returns the same `outstanding_balance` before and after.
4. **Set the cutover before recording new money.** For each account, enter the balance that was true at the end of a chosen date (for example 30 September 2026) and that date. Historical receipts stay unassigned and are already inside that figure. New receipts must name the account. The opening balance freezes once the account has a transaction.
5. **Review `LEGACY_ADDITIONAL`.** Any optional "extra" fee item the school can identify should be reclassified to a real fund.
6. **Walk one of each workflow** on staging: record income, record → approve → pay an expense, a bank-to-petty-cash transfer, a salary through to paid, and a reversal of each.
7. **Confirm role behaviour with real accounts** — in particular that a teacher and the secretary cannot reach `/dashboard/finance/salaries` and see nothing in the salary table.
8. Only then apply to production, in a quiet period, with a fresh backup taken immediately beforehand.

## Known limitations

These are deliberate scope boundaries, not defects.

- **No uniform or tuck shop inventory.** Stock levels, per-item sales, and reorder points are not tracked. Extension points are documented in `FINANCE_FUND_ACCOUNT_MODEL.md`.
- **No point of sale.** Tuck shop income is recorded as a daily or weekly total.
- **No file attachments.** `expenses.document_reference` stores a receipt or invoice number only; there is no upload.
- **Salaries are not a payroll engine.** No PAYE, NAPSA, or NHIMA calculation, no payslip generation, no statutory returns. The school enters agreed gross and deductions.
- **No budgeting.** Funds have no budget to compare actuals against.
- **No negative-balance enforcement.** Petty cash can be recorded below zero. Enforcing it would block legitimate back-dated entries, so it is surfaced visually instead of blocked. Revisit if it proves to be a problem in practice.
- **No per-fund physical segregation.** By design: the school has one bank account, and pretending otherwise was the error this upgrade exists to fix.
- **New schools need provisioning.** Funds, accounts, and expense categories are seeded for schools that exist when the migration runs. A trigger for future schools is a follow-up.
- **Expense approval is a soft separation.** An administrator may approve their own entry, because in a small school there may be nobody else. This is explicit in `approve_expense`, not accidental.

## Production risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Opening balances never set, so account balances read as wrong | **High** if step 4 is skipped | High — staff lose trust in the figures | Called out in the migration plan and in step 4 above; the Accounts page shows the opening balance beside the current balance |
| Staff read a fund net position as cash available | Medium | Medium — overspending | Every fund page states it is not cash; the overview separates "money held" from fund positions; the workflow map addresses it directly |
| Optional "extra" items sit in `LEGACY_ADDITIONAL` and confuse reporting | Medium | Low | Reported as its own line; reclassification is a normal administrator action |
| The legacy-mode split is read as exact when it is an estimate | Medium | Low | Labelled `fifo_estimate` in the API and stated in the interface; disappears once allocations are activated |
| Migration applied to production without staging first | Low | **High** | Explicit sequence above; migrations are not applied by this change set |
| A future developer writes a report that counts transfers as income | Low | High | Structurally prevented by generated columns; verifier checks `FIN-07` and `FIN-08` fail the build if the definitions change |
| Capability matrix drifts between SQL and TypeScript | Low | Medium | `capabilities.test.ts` parses the migration and compares |
| Rollback after go-live destroys records | Low | **High** | Documented: rollback is only clean while the new tables are empty; after that, forward-fix only |

## Verdict

The change set is complete, internally consistent, and passes every check that can be run without a database. It does not modify any existing financial record, function, or balance.

It is **ready for pre-commit review**. It is **not** ready to be applied to the live database without the operator steps above.
