# Finance — Fund and Account Model

**Status:** designed and implemented; migrations created but **not applied**.

There are **seven** new tables: `finance_funds`, `financial_accounts`, `finance_ledger_entries`, `expense_categories`, `expenses`, `finance_transfers`, and `salary_payments`. `fee_items.fund_id` is an added column, not an eighth table.

This document explains the two ideas the whole finance module rests on, and why they are kept apart.

---

## The two questions money has to answer

Every kwacha that touches the school has two independent facts attached to it.

| Question | Answered by | Examples |
|---|---|---|
| **What is this money for?** | a **fund** | School Fees, Uniforms, Meals, Tuck Shop, Other |
| **Where is this money right now?** | a **physical account** | Bank, Mobile Money, Petty Cash |

A parent pays **K800 for a uniform by mobile money**:

- Fund: **Uniforms** increases by K800 — that is what the money is for.
- Account: **Mobile Money** increases by K800 — that is where the money now sits.

These are two facts about one payment, not two payments. The school does **not** have a separate uniform bank account, and the system never pretends it does.

### Why this matters

If funds and accounts are merged, two things go wrong immediately:

1. The school cannot answer "is the tuck shop making money?" because tuck shop income disappears into a bank total.
2. The school cannot answer "how much can I actually spend today?" because a fund balance gets mistaken for cash.

A fund balance is a **result**. An account balance is a **fact**. The interface never labels a fund position as cash in the bank.

---

## Funds

Table: `public.finance_funds`

| Column | Purpose |
|---|---|
| `code` | Stable identifier (`SCHOOL_FEES`, `UNIFORMS`, …). Cannot be changed for system funds. |
| `name`, `description` | What staff see. |
| `is_school_fees` | Marks the one fund that mandatory fee balances are derived from. At most one per school. |
| `is_system` | Seeded funds that reporting depends on; can be deactivated but not renamed away. |
| `is_active`, `sort_order` | Presentation and lifecycle. |
| `created_by`, `updated_by`, timestamps | Audit. |

Seeded per school:

| Code | Name | Role |
|---|---|---|
| `SCHOOL_FEES` | School Fees | Mandatory tuition and compulsory charges |
| `UNIFORMS` | Uniforms | Uniform sales and uniform costs |
| `MEALS` | Meals | Meal collections and catering costs |
| `TUCK_SHOP` | Tuck Shop | Sales, stock, running costs |
| `OTHER` | Other Income | Donations, hire, miscellaneous |
| `GENERAL` | General School Running Costs | Expenditure not attributable to one income activity |
| `LEGACY_ADDITIONAL` | Legacy Additional | Historical optional charges that cannot be reclassified safely |

Administrators can add more funds through `upsert_finance_fund`. A fund is deactivated, never deleted, so history stays attributable.

## Physical accounts

Table: `public.financial_accounts`

| Column | Purpose |
|---|---|
| `code`, `name`, `account_type` | Identity. Code and type are frozen after creation. |
| `masked_reference` | Last few digits only, capped at 12 characters. Full account numbers are never stored. |
| `opening_balance`, `opening_balance_date` | Money in the account at the **end** of the cutover date. Frozen once the account has a ledger entry or an assigned receipt. |
| `default_for_method` | A suggestion on the payment form only. It is **not** used to calculate a balance. At most one account per school may suggest a given method. |
| `is_active`, `sort_order` | Presentation and lifecycle. |

Seeded per school: `BANK` (default for bank transfers), `MOBILE_MONEY` (default for mobile money), `PETTY_CASH`.

---

## The ledger, and what it deliberately does not contain

Table: `public.finance_ledger_entries`

**The ledger does not duplicate student payments.** Receipted student money stays in `public.payments` and `public.payment_allocations`, which already enforce receipt numbering, idempotency, immutability, and reversal. Copying those rows into a ledger would create a second source of truth that could drift.

So the split is:

| Money | Owned by |
|---|---|
| Receipted student payments (fees, uniforms, meals opted into) | `payments` + `payment_allocations` |
| Expenditure, salaries, transfers, non-student income, adjustments | `finance_ledger_entries` |

Reporting unions the two. `finance_student_fund_income` attributes each **allocation** to a fund via `charges → fee_items.fund_id`. It does not guess a fund from the payment. The physical account on that view is `payments.financial_account_id`, which is null for every historical receipt.

### Physical balance

```
current balance
  = opening balance
  + ledger movements dated after opening_balance_date
  + completed receipts that name this account and are dated after opening_balance_date
```

Receipts with no account are excluded. Receipts on the cutover date are excluded, because the opening balance is the position at the **end** of that day. Payment method is never consulted. A voided receipt is excluded because only `completed` receipts count.

### Fund position

```
fund net
  = student income from payment allocations to that fund
  + other income posted to that fund on the ledger
  − expenditure posted to that fund on the ledger
```

Transfers contribute nothing to either side. Until payment allocations are switched on, historical student receipts are **not** in fund income. They are not estimated there. The student page may show a labelled FIFO estimate; fund reports do not.

There is no second opening figure on a fund. Historical allocated payments are the fund's student income, so they are not also added as an opening balance.

### Entry shape

| Column | Notes |
|---|---|
| `entry_type` | `income`, `expense`, `transfer_in`, `transfer_out`, `adjustment` |
| `direction` | `in` or `out`; fully determined by type, and flipped for reversals |
| `amount` | `numeric(12,2)`, always **positive**. Sign comes from direction, never from input. |
| `fund_id` | Required for income and expense; **forbidden** for transfers |
| `account_id` | Always required |
| `source_type` / `source_id` | Links back to the owning expense, salary, or transfer |
| `is_reversal`, `reverses_entry_id` | Reversal relationship; unique index prevents reversing twice |
| `reversed_at`, `reversed_by`, `reversal_reason` | Stamped on the original |

### Signed effects are computed by the database

Three generated columns make the accounting rules structural rather than a convention a query could forget:

```sql
account_delta  = direction = 'in'  ?  +amount : -amount
income_effect  = entry_type = 'income'  ? (direction = 'in'  ? +amount : -amount) : 0
expense_effect = entry_type = 'expense' ? (direction = 'out' ? +amount : -amount) : 0
```

Because `income_effect` and `expense_effect` are zero for both transfer types, **a transfer can never inflate income or expenditure**, no matter how a report is written. A reversal carries the opposite direction, so it subtracts from the total it originally added to.

---

## Transfers

Table: `public.finance_transfers`, written only by `record_account_transfer`.

A transfer of K3,000 from Bank to Petty Cash creates, in one transaction:

1. a `finance_transfers` row,
2. a `transfer_out` ledger entry on Bank (−K3,000),
3. a `transfer_in` ledger entry on Petty Cash (+K3,000).

Result: Bank −K3,000, Petty Cash +K3,000, **income K0, expenditure K0**. The `finance_transfers_both_legs` constraint means a one-sided transfer cannot be committed, and reversal reverses both legs together.

---

## Money representation

- Database: `numeric(12,2)`, currency fixed to `ZMW` by check constraint. This matches `charges` and `payments` exactly.
- Application: integer **ngwee** (1 Kwacha = 100 ngwee) via `src/lib/money.ts`. No floating-point arithmetic is performed on money anywhere.
- Input validation rejects amounts with more than two decimal places rather than rounding them.

## Extension points left open

- **Uniform inventory** — `finance_ledger_entries.student_id` and `reference` already allow linking a sale to a pupil and a stock document. A future `uniform_stock` table can attach without changing the ledger.
- **Tuck shop point of sale** — daily takings are recorded as a single income entry today; a per-item sales table can later summarise into the same entry shape.
- **Document attachments** — `expenses.document_reference` and `document_note` hold metadata only. File storage is deferred.
- **Budgets** — funds are the natural anchor for a future budget-vs-actual comparison.
