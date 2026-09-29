# Finance — Data Migration Plan

> **The migrations in this plan have NOT been applied to any database.** They exist as files in `supabase/migrations/` and are ready for review. Applying them is a separate, operator-owned decision.

---

## Migrations created

| Order | File | Contents |
|---|---|---|
| 1 | `20260929120000_finance_funds_accounts_capabilities.sql` | `finance_funds`, `financial_accounts`, `has_finance_capability`, `fee_items.fund_id`, seed data, fee-catalogue backfill, audit vocabulary extension |
| 2 | `20260929120100_finance_ledger.sql` | `finance_ledger_entries` with generated effect columns, validation and immutability triggers, account identity guard, RLS |
| 3 | `20260929120200_finance_expenses_transfers_salaries.sql` | `expense_categories`, `expenses`, `finance_transfers`, `salary_payments`, immutability triggers, category seed, RLS |
| 4 | `20260929120300_finance_rpcs.sql` | All mutating RPCs |
| 5 | `20260929120400_finance_reporting.sql` | `finance_student_fund_income` view and the reporting functions |
| 6 | `20260929120500_finance_cutover_attribution.sql` | Cutover-safe account balances, explicit receipt attribution, idempotency keys, salary overlap, new-school provisioning |

They must be applied in this order; each depends on the previous one.

## What this migration does **not** do

- It does not modify `charges`, `payment_allocations`, or `payment_finance_snapshots`.
- It does not replace `record_payment`, `void_payment`, `apply_available_credit`, `cancel_optional_charge`, or `get_student_finance_summary`.
- The only change to `payments` is a nullable `financial_account_id` plus an insert trigger. Historical receipts stay null. Receipt snapshots are not rewritten.
- It does not delete or archive any row.
- It does not change any existing balance, receipt, or audit record.

Verified by checks `FIN-13`, `FIN-14`, and `FIN-19` in `scripts/finance-integrity-verify.cjs`.

## The only change to an existing table

```sql
alter table public.fee_items
  add column if not exists fund_id uuid references public.finance_funds(id);
```

Nullable, no default, no rewrite of existing data beyond the backfill below.

## The backfill, and why it does not guess

Every fee item is mapped to a fund from information the catalogue already records. `fee_category` is a closed enum, so the mapping is total and deterministic:

| `fee_items.category` | `is_optional` | Fund | Confidence |
|---|---|---|---|
| `tuition` | any | `SCHOOL_FEES` | Certain — tuition is by definition a mandatory fee |
| `meal` | any | `MEALS` | Certain — the category says so |
| `uniform` | any | `UNIFORMS` | Certain — the category says so |
| `extra` | `false` | `SCHOOL_FEES` | High — a non-optional charge is compulsory, so it belongs in the mandatory balance |
| `extra` | `true` | `LEGACY_ADDITIONAL` | **Unknown** — an optional "extra" could be a trip, a book, or anything else. The data does not say, so it is not guessed at. |

`LEGACY_ADDITIONAL` exists precisely so that unclassifiable history has a safe, honest home. It is excluded from mandatory school-fee balances (correct: it was optional) and reported separately so an administrator can reclassify at leisure.

The backfill is:

```sql
update public.fee_items fi
set fund_id = f.id
from public.finance_funds f
where fi.fund_id is null            -- only fills gaps
  and f.school_id = fi.school_id    -- never crosses schools
  and f.code = case ... end;        -- deterministic
```

**Rerun-safe:** `where fi.fund_id is null` means a second run changes nothing, and an administrator's later reclassification is never overwritten.

A `BEFORE INSERT OR UPDATE` trigger applies the same rule to new fee items, so the catalogue cannot drift back into an unmapped state.

## Effect on existing balances

**None.** This is the most important property of the plan.

`get_student_finance_summary` is untouched, so `outstanding_balance` returns exactly what it returned before. Receipts, `payment_finance_snapshots`, the fee balances report, and the overpayment guard inside `record_payment` all continue to read the same number.

The mandatory/optional split is delivered by a **new** function, `get_student_finance_breakdown`, which reports:

- `school_fees`: charged, paid, outstanding — restricted to the fund flagged `is_school_fees`
- `additional`: the same three figures per non-fee fund
- `basis`: `allocations` when the FIFO engine is active, `fifo_estimate` otherwise

This is why the audit's §13 warning is honoured: a field that many things depend on was not quietly redefined.

For a pupil charged K4,500 in tuition and K900 for a uniform, having paid K3,500:

| Figure | Before | After |
|---|---|---|
| `get_student_finance_summary.outstanding_balance` | K1,900 | K1,900 (unchanged, by design) |
| School fees outstanding (new) | not available | **K1,000** |
| Additional outstanding (new) | not available | K900 |

The student page and the Finance overview now lead with the split figures. The combined figure remains available and consistent with every historical record.

### A note on the legacy mode estimate

When `finance_allocation_gates.activated_at` is not set, payments are not allocated to individual charges, so the split cannot be derived from stored facts. In that mode the breakdown applies payments to charges oldest-first — the exact ordering `allocate_payment_to_charges` uses — and labels itself `fifo_estimate` in both the API and the interface. It is presented as an estimate because that is what it is.

## Seed data

Per school, `INSERT ... ON CONFLICT (school_id, code) DO NOTHING`:

- 7 funds: `SCHOOL_FEES`, `UNIFORMS`, `MEALS`, `TUCK_SHOP`, `OTHER`, `GENERAL`, `LEGACY_ADDITIONAL`
- 3 accounts: `BANK`, `MOBILE_MONEY`, `PETTY_CASH`, all with opening balance 0
- 13 expense categories

Rerun-safe. Adding a school later requires seeding that school; this is noted as a follow-up in the release readiness document.

**Opening balances start at zero, with no cutover date.** Before any new receipt is assigned to an account, an administrator sets the real balance and the date it was true (the end of that day). Example: on 30 September 2026 the bank statement says K50,000. That figure already includes every fee receipt up to and including 30 September, so those receipts stay unassigned and are not added again. A receipt on 1 October that names the bank account is added. The opening balance freezes once the account has a ledger entry or an assigned receipt.

## Rollback

The migrations are additive, so rollback is a matter of dropping what was added, in reverse order:

```sql
-- reporting
drop function if exists public.get_student_finance_breakdown(uuid);
drop function if exists public.get_finance_overview(date, date);
drop function if exists public.get_finance_fund_positions(date, date);
drop function if exists public.get_financial_accounts_summary();
drop function if exists public.finance_account_balance(uuid, date);
drop view if exists public.finance_student_fund_income;

-- RPCs: drop each function created in 20260929120300

-- tables (order matters)
drop table if exists public.salary_payments;
drop table if exists public.finance_transfers;
drop table if exists public.expenses;
drop table if exists public.expense_categories;
drop table if exists public.finance_ledger_entries;

alter table public.fee_items drop column if exists fund_id;
drop table if exists public.financial_accounts;
drop table if exists public.finance_funds;

-- restore the original audit vocabulary check constraint
```

**Rollback is only clean while the new tables are empty.** Once real expenses, salaries, or transfers have been recorded, dropping those tables destroys financial records. After go-live, treat forward-fix as the only option.

## Recommended application sequence

1. Review the five migration files as a change set.
2. Apply to a staging database first, not to production.
3. Confirm the seed data appeared, and that `get_student_finance_summary` returns identical values for a sample of pupils before and after.
4. Confirm `get_student_finance_breakdown` splits those same pupils sensibly.
5. Set the real opening balance on each account **before** recording any transaction.
6. Reclassify anything sitting in `LEGACY_ADDITIONAL` if the school knows what it was.
7. Only then apply to production, during a quiet period, with a backup taken immediately beforehand.

## Open item

Schools created after these migrations run will not have funds, accounts, or expense categories. A `handle_new_school` trigger or an explicit provisioning step should be added before the system becomes multi-school. Today there is one school, so this is not blocking.
