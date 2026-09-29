# Finance — Test Matrix

Two layers of automated coverage:

- **Vitest** — pure logic, validation, and the capability matrix. Runs in `npm test`.
- **Static invariant verifier** — `scripts/finance-integrity-verify.cjs`, which reads the migrations and source and proves the structural invariants. Also run as part of `npm test` via `scripts/finance-integrity-verify.test.ts`.

Everything runs offline. Nothing connects to a database, so the suite is safe in CI and on a developer machine.

---

## Files

| File | Tests | Covers |
|---|---|---|
| `src/features/finance/ledger-math.test.ts` | 13 | Signed effects, transfer neutrality, reversal arithmetic, decimal safety, running balances |
| `src/features/finance/reconciliation.test.ts` | 11 | Cutover balances, fund equation, FIFO allocation, expense transitions |
| `src/features/finance/capabilities.test.ts` | 15 | Role matrix, SQL/TypeScript parity, salary restriction, separation of duties |
| `src/features/finance/schemas.test.ts` | 19 | Input validation at the boundary |
| `scripts/finance-integrity-verify.test.ts` | 31 | All 28 static invariants, plus coverage completeness |

89 new tests in total (78 from the upgrade, plus 11 reconciliation tests added in pre-commit review). The verifier file grew with the cutover checks.

## Invariant coverage

| ID | Invariant | Verified by |
|---|---|---|
| FIN-01 | Amounts are positive at every input boundary | `schemas.test.ts`, verifier `FIN-01` |
| FIN-02 | No silent deletion of financial records | verifier `FIN-02` |
| FIN-03 | No free editing of posted transactions | verifier `FIN-03` |
| FIN-04 | A reversal references its original | verifier `FIN-04` |
| FIN-05 | No double reversal | verifier `FIN-05` |
| FIN-06 | Transfers are atomic, never one-sided | verifier `FIN-06` |
| FIN-07 | Transfers are not income | `ledger-math.test.ts`, verifier `FIN-07` |
| FIN-08 | Transfers are not expenditure | `ledger-math.test.ts`, verifier `FIN-08` |
| FIN-09 | School fee balance excludes uniforms, meals, tuck shop | verifier `FIN-09` |
| FIN-10 | Each fund reports independently | verifier `FIN-10` |
| FIN-11 | Funds and accounts are never conflated | verifier `FIN-11` |
| FIN-12 | No duplicate salary per staff member per period | verifier `FIN-12` |
| FIN-13 | Payment idempotency is intact | verifier `FIN-13` |
| FIN-14 | Completed-payment protections are intact | verifier `FIN-14` |
| FIN-15 | Every mutation is auditable | verifier `FIN-15` |
| FIN-16 | No cross-school access | verifier `FIN-16` |
| FIN-17 | No unauthorised salary visibility | `capabilities.test.ts`, verifier `FIN-17` |
| FIN-18 | Historical attribution survives deactivation | verifier `FIN-18` |
| FIN-19 | Deactivation does not delete | verifier `FIN-19` |
| FIN-20 | Reports derive from authoritative records | verifier `FIN-20` |
| SEC-01 | Every SECURITY DEFINER function locks `search_path` | verifier |
| SEC-02 | Internal helpers are not client-callable | verifier |
| SEC-03 | No service-role credentials reachable from the browser | verifier |
| SEC-04 | Every client-callable RPC checks a capability | verifier |
| SEC-05 | The fee catalogue maps deterministically, rerun-safe | verifier |
| UX-01 | Finance never offers Delete for a posted transaction | verifier |
| MONEY-01 | Money math goes through integer ngwee | verifier |

## What the tests actually assert

**Transfer neutrality.** A K3,000 bank-to-petty-cash pair produces income K0 and expenditure K0. The verifier additionally reads the generated column definitions and fails if either one so much as mentions a transfer type, so the guarantee cannot be weakened by a future edit.

**Reversal arithmetic.** An income reversal subtracts from income; an expense reversal subtracts from expenditure; an amount followed by its reversal nets to zero.

**Decimal safety.** `0.1 + 0.2 - 0.3` sums to exactly `0`, and ten successive deductions of `K0.07` from `K1.00` leave exactly `K0.30`. Input validation rejects `10.005` rather than rounding it into someone's account.

**Capability parity.** The test parses `has_finance_capability` out of the migration and compares each role's capability set against the TypeScript mirror. If either side is edited alone, the build fails.

**Salary restriction.** Teachers and secretaries are proven to hold none of the four salary capabilities, and the verifier confirms the secretary block in SQL contains no `SALARY` string at all.

**Separation of duties.** A bursar can record and pay a salary but cannot approve one, and cannot reconfigure funds or accounts.

**Regression protection.** The verifier fails if any finance migration drops a trigger or policy on `payments` or `charges`, alters `public.payments`, grants write access to it, or references the existing immutability triggers. It also fails if student payments are ever copied into the ledger, which would create the second source of truth the architecture exists to avoid.

## Existing tests, unchanged

No pre-existing test was modified or weakened. The suite grew from 306 to 400 passing tests; the previously passing 306 still pass unchanged, including `payment-preview.test.ts`, `migration-status.test.ts`, `money.test.ts`, and the examinations and report-card suites.

## Gaps, stated plainly

These cannot be covered without a database, and are **not** claimed as passing:

| Gap | Why | How to close |
|---|---|---|
| RLS policies actually deny a real unauthorised session | Needs a live Postgres with seeded roles | `supabase/tests/` pgTAP suite, run against staging |
| Trigger behaviour under concurrency | Needs real transactions | Staging load test on `record_account_transfer` |
| The backfill produces the expected mapping on real data | Needs the production catalogue | Dry-run on a staging restore |
| Account balances reconcile against bank statements | Needs real money | Operator reconciliation after go-live |
| End-to-end browser flows | No E2E harness in this repository | Manual staging smoke, then Playwright if one is added |

The verifier lists three of these explicitly under "requires online verification" and refuses to attempt them, rather than reporting a pass it has not earned.

## Running the suite

```bash
npm test                                  # everything, including the verifier
npx vitest run src/features/finance       # finance unit tests only
node scripts/finance-integrity-verify.cjs # verifier alone, with a readable report
```
