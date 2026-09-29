# Finance — Security and RLS Audit

Covers every table, view, and function added by the finance upgrade. Verified statically by `scripts/finance-integrity-verify.cjs` (checks `SEC-01` … `SEC-05`, `FIN-16`, `FIN-17`).

---

## Access model

Two predicates gate everything:

- `public.current_user_school_id()` — school scoping, already used throughout the system.
- `public.has_finance_capability(text)` — capability scoping, added by this upgrade.

Every finance table has `school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT` and RLS enabled.

## Table-by-table policy

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `finance_funds` | school + `FINANCE_FUNDS_VIEW` | revoked | revoked | revoked |
| `financial_accounts` | school + `FINANCE_ACCOUNTS_VIEW` | revoked | revoked | revoked |
| `finance_ledger_entries` | school + `FINANCE_VIEW`, and salary rows additionally require `FINANCE_SALARY_VIEW` | revoked | revoked | revoked |
| `expense_categories` | school + `FINANCE_VIEW` | revoked | revoked | revoked |
| `expenses` | school + `FINANCE_EXPENSE_RECORD` | revoked | revoked | revoked |
| `finance_transfers` | school + `FINANCE_ACCOUNTS_VIEW` | revoked | revoked | revoked |
| `salary_payments` | school + `FINANCE_SALARY_VIEW` | revoked | revoked | revoked |

`payments.financial_account_id` is nullable. It is set only by the insert trigger from an explicit choice. Client update of `payments` remains blocked by the existing immutability trigger.

Every client write is revoked. There is no direct-insert path into any finance table; all mutation goes through SECURITY DEFINER RPCs. This is the same posture already used for `payments`.

`public.finance_student_fund_income` is a view declared `WITH (security_invoker = true)`, so it runs under the caller's own RLS on `payments`, `payment_allocations`, `charges`, and `fee_items` rather than the view owner's.

## SECURITY DEFINER functions

Every one of them sets `search_path = public`, verified by check `SEC-01`.

### Client-callable (granted to `authenticated`, revoked from `public` and `anon`)

| Function | Capability required |
|---|---|
| `record_fund_income` | `FINANCE_LEDGER_RECORD` |
| `reverse_fund_income` | `FINANCE_REVERSE` |
| `record_expense` | `FINANCE_EXPENSE_RECORD` |
| `approve_expense` | `FINANCE_EXPENSE_APPROVE` |
| `pay_expense` | `FINANCE_EXPENSE_PAY` |
| `reverse_expense` | `FINANCE_REVERSE` |
| `record_account_transfer` | `FINANCE_TRANSFER_RECORD` |
| `reverse_account_transfer` | `FINANCE_REVERSE` |
| `record_salary_payment` | `FINANCE_SALARY_RECORD` |
| `approve_salary_payment` | `FINANCE_SALARY_APPROVE` |
| `pay_salary_payment` | `FINANCE_SALARY_PAY` |
| `reverse_salary_payment` | `FINANCE_SALARY_RECORD` + `FINANCE_REVERSE` |
| `upsert_finance_fund` | `FINANCE_SETUP_MANAGE` |
| `upsert_financial_account` | `FINANCE_SETUP_MANAGE` |
| `get_finance_overview` | `FINANCE_VIEW` |
| `get_finance_fund_positions` | `FINANCE_FUNDS_VIEW` |
| `get_financial_accounts_summary` | `FINANCE_ACCOUNTS_VIEW` |
| `finance_account_balance` | `FINANCE_ACCOUNTS_VIEW` |
| `get_student_finance_breakdown` | signed-in, school-scoped student check |

### Internal only (revoked from `public`, `anon`, **and** `authenticated`)

- `finance_require(text)`
- `finance_post_entry(...)`
- `finance_reverse_entry(uuid, text)`

These are the only functions that write to the ledger. Because they are unreachable from a client, a caller cannot post an arbitrary entry, and cannot stamp a reversal marker without going through a reversal RPC.

## Why SECURITY DEFINER is justified in each case

All finance writes need DEFINER for the same reason `record_payment` already does: client roles have no write privilege on the tables at all, which is what makes "the only way to move money is through an approved workflow" true. Each function therefore performs the checks RLS would otherwise perform.

Per-function validation, in order:

1. **Caller is authenticated.** `auth.uid() is null` raises.
2. **School resolved from the caller.** `current_user_school_id()`. No function accepts a school id parameter — verified by check `FIN-16` across every granted function.
3. **Capability checked.** `finance_require('…')`.
4. **Referenced rows belong to that school and are active.** Funds, accounts, staff, and students are each re-verified. `finance_ledger_validate` re-checks fund, account, and student school membership on every insert as a second line of defence.
5. **Amount validated.** Rounded to two decimal places and required to be greater than zero, before any insert.
6. **State transition validated.** An expense must be approved before payment; a salary must be approved before payment; a reversed record cannot be touched; a transaction cannot be reversed twice.
7. **Ownership and duplication.** Salary records are unique per staff member per pay period, enforced by a partial unique index as well as an explicit check.

## Specific attack surfaces considered

**Cross-school access.** Not expressible. School comes from the session, and every referenced id is re-validated against it both in the RPC and in the ledger insert trigger.

**Arbitrary fund or account injection.** A caller could pass any UUID as `p_fund_id`. Both the RPC and `finance_ledger_validate` reject a fund or account from another school, and inactive ones are refused at the RPC.

**Posting income to School Fees to bypass receipting.** `record_fund_income` explicitly refuses any fund flagged `is_school_fees`, so fee money always goes through `record_payment` and always produces a receipt.

**Recording a salary as an ordinary expense to dodge duplicate protection.** `record_expense` refuses any category flagged `is_salary`.

**Inflating income with a transfer.** Structurally impossible: `income_effect` and `expense_effect` are generated columns that are zero for both transfer types.

**One-sided transfer.** The `finance_transfers_both_legs` constraint plus a single-transaction RPC mean a half-completed transfer cannot commit.

**Editing a posted transaction.** `finance_ledger_enforce_immutability` rejects every `UPDATE` unless `app.allow_ledger_reversal` is set, which only `finance_reverse_entry` does, and even then only the reversal marker columns may change. `DELETE` is rejected unconditionally.

**Rewriting history by changing reference data.** Fund codes and the School Fees designation are frozen for system funds; account codes and types are frozen outright; an account's opening balance freezes as soon as it has transactions.

**Leaking salary through a general export.** Three separate barriers, described in `FINANCE_ROLE_MATRIX.md`.

**Service-role key in the browser.** No finance code touches it. Check `SEC-03` fails the build if any file reads `process.env.SUPABASE_SERVICE_ROLE_KEY` without `import "server-only"`, if a client component reads it, or if it is ever exposed through a `NEXT_PUBLIC_` variable.

**Sensitive banking details.** `financial_accounts.masked_reference` is capped at 12 characters by both a check constraint and the RPC, so a full account number cannot be stored.

## Audit trail

Every mutating RPC writes to `public.finance_event_audits` through `log_finance_event`, which remains revoked from all client roles. Check `FIN-15` verifies that each of the eleven mutating functions calls it.

New event types added to the check constraint: `ledger_entry_posted`, `ledger_entry_reversed`, `expense_recorded`, `expense_approved`, `expense_paid`, `expense_reversed`, `transfer_recorded`, `transfer_reversed`, `salary_recorded`, `salary_approved`, `salary_paid`, `salary_reversed`, `fund_created`, `fund_updated`, `account_created`, `account_updated`. The eight pre-existing types are preserved unchanged.

## Not covered here

- Live penetration testing against the deployed database. Not performed; migrations are not applied.
- Rate limiting on finance RPCs. Not implemented; inherits whatever Supabase applies at the gateway.
- Attachment storage security. Deferred with the feature.
