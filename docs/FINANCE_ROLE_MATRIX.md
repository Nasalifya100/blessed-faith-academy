# Finance — Role and Permission Matrix

The database is the authority. `public.has_finance_capability(text)` decides everything; the TypeScript mirror in `src/features/finance/capabilities.ts` only controls what the interface bothers to render. `capabilities.test.ts` parses the migration and fails the build if the two ever disagree.

This extends the existing role model. It does **not** introduce a second role system: `has_finance_capability` reads the same `profiles.role` column as `can_manage_fees()` and `has_academic_capability()`, and follows the academics pattern that is already proven in this codebase.

---

## Matrix

| Capability | Administrator | Head teacher | Bursar | Secretary | Teacher |
|---|:--:|:--:|:--:|:--:|:--:|
| `FINANCE_VIEW` | ● | ● | ● | ● | — |
| `FINANCE_FUNDS_VIEW` | ● | ● | ● | ● | — |
| `FINANCE_ACCOUNTS_VIEW` | ● | ● | ● | — | — |
| `FINANCE_REPORTS_VIEW` | ● | ● | ● | — | — |
| `FINANCE_LEDGER_RECORD` | ● | ● | ● | — | — |
| `FINANCE_EXPENSE_RECORD` | ● | ● | ● | — | — |
| `FINANCE_EXPENSE_APPROVE` | ● | ● | — | — | — |
| `FINANCE_EXPENSE_PAY` | ● | ● | ● | — | — |
| `FINANCE_TRANSFER_RECORD` | ● | ● | ● | — | — |
| `FINANCE_PETTY_CASH_RECORD` | ● | ● | ● | — | — |
| `FINANCE_REVERSE` | ● | ● | ● | — | — |
| `FINANCE_SALARY_VIEW` | ● | ● | ● | — | — |
| `FINANCE_SALARY_RECORD` | ● | ● | ● | — | — |
| `FINANCE_SALARY_APPROVE` | ● | ● | — | — | — |
| `FINANCE_SALARY_PAY` | ● | ● | ● | — | — |
| `FINANCE_SETUP_MANAGE` | ● | ● | — | — | — |

## Why each role sits where it does

**Teacher — no finance authority at all.** A teacher has no finance capability of any kind, so the Finance area does not appear in navigation, every finance route redirects, and RLS returns nothing from every finance table. Salary data in particular is unreachable at three independent layers.

**Secretary — operational visibility only.** The secretary can see that the Funds exist and read the overview, because they field parent questions. They cannot see account balances, cannot see salaries, and cannot move money in any way. Their existing fee-area access (the requirements checklist, the balances report) is unchanged.

**Bursar — runs finance day to day.** Records and pays expenses, records transfers, tops up and spends petty cash, prepares and pays salaries, and reverses mistakes. Two things are deliberately withheld:

- `FINANCE_EXPENSE_APPROVE` and `FINANCE_SALARY_APPROVE` — a bursar who prepares and pays should not also approve. That is the separation of duties an auditor will look for.
- `FINANCE_SETUP_MANAGE` — a bursar cannot create funds or accounts, which would let them redirect money into a category nobody is watching.

**Head teacher — oversight and approval.** Everything the bursar can do, plus approval of expenses and salaries, plus fund and account configuration.

**Administrator — full authority.** Including the ability to approve their own entries, because in a small school the administrator is sometimes the only person available. The headteacher has the same setup capability, so they can self-approve as well. The bursar cannot. Every self-approval is stored on the audit event as `self_approved: true` and shown on the expense.

**Bursar and salaries.** The bursar can see individual salary amounts, because the bursar is the person who pays them. The bursar cannot approve a salary. The headteacher approves. Teachers and the secretary have no salary capability, and salary audit events are hidden from anyone without `FINANCE_SALARY_VIEW`.

## Where each check happens

| Layer | Mechanism | Purpose |
|---|---|---|
| Navigation | `canOpenFinance(role)` in `src/app/dashboard/layout.tsx` | Do not show what cannot be used |
| Route | `hasFinanceCapability(...)` then `redirect()` in each page | Do not render a page the caller cannot use |
| Server action | `assertCapability(...)` in `src/features/finance/actions.ts` | Fail fast with a clear message |
| **RPC** | `public.finance_require('CAPABILITY')` | **The real gate.** Every mutation passes through it |
| **RLS** | capability predicate in every `SELECT` policy | **The real gate for reads** |

The first three are convenience. Removing all three would change nothing about what a determined caller can do, because the database refuses independently.

## Salary sensitivity

Salary data is restricted more aggressively than anything else in the system:

1. `salary_payments` `SELECT` policy requires `FINANCE_SALARY_VIEW`.
2. `finance_ledger_entries` `SELECT` policy additionally hides rows where `source_type = 'salary'` from anyone without `FINANCE_SALARY_VIEW`, so salary payments cannot be inferred from the general ledger.
3. The financial reports export filters out `source_type = 'salary'` entirely, even for a caller who *does* hold the capability — salary detail is only available in the Salaries area.
4. `record_expense` refuses any category flagged `is_salary`, so salaries cannot be smuggled through the ordinary expense form.

## Changing permissions later

Edit `public.has_finance_capability` in a new migration, then update `src/features/finance/capabilities.ts` to match. `capabilities.test.ts` compares the two and will fail if only one is changed.
