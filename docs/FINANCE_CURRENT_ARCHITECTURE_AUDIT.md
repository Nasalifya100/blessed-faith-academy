# Finance — Current Architecture Audit (pre-upgrade)

**Audit date:** 2026-09-29
**Scope:** Read-only inspection of the finance module as it exists in the repository before the fund/account upgrade.
**Method:** Migrations, application source, tests, scripts, and docs were read directly. No live database was queried.

This document records what the system does **today**. It is the baseline the upgrade must not break.

---

## 1. Authoritative table for student charges

`public.charges`.

One row per student liability. Key columns: `school_id`, `student_id`, `fee_item_id`, `academic_year_id`, `term_id`, `amount numeric(12,2)`, `status charge_status`, `charge_source`.

- `charge_status` = `outstanding | paid | waived | cancelled`.
- `charge_source` = `NORMAL | LEGACY_OPENING_BALANCE` (opening balances from the paper era).
- Amounts are frozen by the `charges_enforce_immutability` trigger; only a status change is permitted, and only while the `app.allow_charge_status_update` GUC is set by an approved function.
- Four partial unique indexes prevent duplicate active charges, split by `charge_source` and by term vs year scope.
- Direct `UPDATE` / `DELETE` are revoked. `INSERT` requires `can_manage_fees()`.

## 2. Authoritative table for payments

`public.payments`.

There is **no separate receipts table** — the receipt is the payment row, identified by `receipt_number` (unique per school, format `{schools.receipt_prefix}-{year}-{0001}`).

- `amount numeric(12,2) > 0`, `method payment_method` (`mobile_money | bank_transfer`; cash was deliberately removed), `status payment_status` (`completed | voided`).
- `idempotency_key uuid` with a partial unique index on `(school_id, idempotency_key)`.
- Void metadata (`void_reason`, `voided_at`, `voided_by`) is enforced by a check constraint.
- `payments_enforce_immutability` trigger permits only `completed → voided`, and only under the `app.allow_payment_void` GUC.
- `INSERT`, `UPDATE`, `DELETE` are all revoked from clients. Payments can only be created by the `record_payment` RPC.

Supporting tables: `payment_allocations` (payment → charge links, soft-reversible) and `payment_finance_snapshots` (immutable one-row-per-payment balance snapshot used by receipts).

## 3. How balances are calculated

Authoritative source is the `get_student_finance_summary(p_student_id)` RPC. The school runs in one of two modes, gated per school by `finance_allocation_gates.activated_at` and read through `finance_allocations_are_active(school_id)`:

| Mode | Outstanding formula | Credit |
|---|---|---|
| Legacy (pre-activation) | `Σ active charges − Σ completed payments`, floored at 0 | none; overpayment rejected |
| Allocation-enabled (current) | `Σ max(0, charge.amount − charge_active_allocated(charge.id))` | `Σ completed payments − Σ active allocations` |

`getStudentFeeStatement()` in `src/features/fees/queries.ts` reads this RPC and exposes it as `statement.balance`. `getFeeBalancesReport()` in `src/features/reports/queries.ts` re-derives the same figure per student for the roster report.

**Finding that matters for the upgrade:** the outstanding balance sums **every** active charge with no filter on `fee_items.category` or `fee_items.is_optional`. An opted-in meal or uniform charge therefore raises the same number the school reads as "school fees owed". See §13.

## 4. How receipts are generated

Receipt number is allocated inside `record_payment` by scanning existing receipt numbers for the school and year under a row lock, then formatting `{prefix}-{year}-{NNNN}`.

Rendering is server-side at `/dashboard/payments/[id]/receipt` from `getPaymentReceipt(paymentId)`. Balance figures on the receipt come from the immutable `payment_finance_snapshots` row; legacy payments without a snapshot display a disclaimer instead of recalculating. Printing is `window.print()` — there is no server-side PDF generation.

## 5. How reversals work

`void_payment(p_payment_id, p_reason)`, SECURITY DEFINER, requires `can_manage_fees()` and a non-empty reason.

It takes an advisory lock on `(school, student)`, soft-reverses every active allocation (`reversed_at`, `reversed_by`, `reversal_reason`), sets the payment to `voided`, and writes `allocations_reversed` plus `payment_voided` audit events. The original payment row and its receipt remain permanently visible. Nothing is deleted.

`get_void_payment_preview(p_payment_id)` shows the impact before confirming.

## 6. How optional charges work

`fee_items.is_optional boolean` marks a catalogue item as opt-in. Categories `meal` and `uniform` are treated as optional in the UI.

- `create_optional_charge(p_student_id, p_fee_item_id, p_term_id)` creates the charge; it validates `is_optional = true` in the database.
- `charges_enforce_one_meal_per_term` limits a student to one NORMAL meal charge per term.
- `cancel_optional_charge(p_charge_id, p_reason)` cancels one, but only while it is `outstanding` and has no active allocations. It writes an `optional_charge_cancelled` audit event.

An optional item that has not been opted into has no charge row and therefore no financial effect.

## 7. How school fees differ from optional charges today

Only by catalogue metadata (`fee_items.category` and `fee_items.is_optional`) and by how the charge is created (`create_charges_for_student` / `_for_class` skip optional items; `create_optional_charge` handles them).

**Once a charge row exists, the two are financially indistinguishable.** Both sit in `charges`, both are summed into one outstanding balance, both are settled by the same FIFO allocation, and no column records which activity the money belongs to. There is no fund concept anywhere in the schema.

## 8. RPCs that can mutate financial records

| Function | Security | Gate |
|---|---|---|
| `record_payment(uuid, numeric, payment_method, uuid, text, date, text) → jsonb` | DEFINER | `can_manage_fees()` |
| `void_payment(uuid, text) → uuid` | DEFINER | `can_manage_fees()` |
| `apply_available_credit(uuid) → jsonb` | DEFINER | `can_manage_fees()` + allocations active |
| `cancel_optional_charge(uuid, text) → void` | DEFINER | `can_manage_fees()` |
| `create_charges_for_student(uuid, uuid) → int` | INVOKER | `can_manage_fees()` |
| `create_charges_for_class(uuid, uuid) → int` | INVOKER | `can_manage_fees()` |
| `create_optional_charge(uuid, uuid, uuid) → uuid` | INVOKER | `can_manage_fees()` |
| `create_existing_student_migration(jsonb) → jsonb` | DEFINER | `can_manage_students() AND can_manage_fees()` |
| `allocate_payment_to_charges(uuid, uuid, text) → numeric` | DEFINER | revoked from clients; internal only |
| `log_finance_event(...) → uuid` | DEFINER | revoked from clients; internal only |
| `run_payment_allocation_backfill`, `activate_payment_allocations`, … | DEFINER | revoked from clients; console/service-role only |

Every DEFINER function sets `search_path = public`.

## 9. Roles permitted to perform financial operations

There is **no finance capability system**. Finance is gated by one role predicate:

```sql
create or replace function public.can_manage_fees() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and role in ('administrator', 'bursar', 'headteacher')
  );
$$;
```

In the application, `FEE_MANAGER_ROLES` = `administrator, bursar, headteacher` (`src/features/auth/permissions.ts`), with `canManageFees(role)`. Secretary gets read access to the fees hub and the balances report, plus write access to the non-monetary requirements checklist. Teachers have no finance access.

Role arrays are duplicated in `src/features/fees/actions.ts`, `src/app/dashboard/fees/page.tsx`, `src/app/dashboard/reports/fee-balances/page.tsx`, and `src/app/dashboard/students/[id]/page.tsx`.

Academics, by contrast, does have a capability system: `has_academic_capability(text)`. The finance upgrade should follow that proven pattern rather than invent a third approach.

## 10. RLS policies protecting finance data

Every finance table has RLS enabled and a `school_id` column; reads are scoped with `school_id = public.current_user_school_id()`.

| Table | SELECT | Writes |
|---|---|---|
| `fee_items`, `fee_schedules` | school scope | INSERT/UPDATE need `can_manage_fees()`; DELETE revoked |
| `charges` | school scope | INSERT needs `can_manage_fees()`; UPDATE/DELETE revoked |
| `payments` | school scope | all client writes revoked |
| `payment_allocations` | school scope | writes revoked (DEFINER only) |
| `payment_finance_snapshots` | school scope | writes revoked |
| `finance_event_audits` | school scope **and** `can_manage_fees()` | writes revoked |
| `finance_allocation_gates` | school scope **and** `is_administrator()` | writes revoked |
| `legacy_migration_audits` | school scope | writes revoked |

## 11. How audit events are recorded

`public.finance_event_audits`, appended only through `log_finance_event(...)` which is revoked from all client roles. A check constraint restricts `event_type` to: `payment_recorded`, `allocation_created`, `advance_credit_created`, `credit_applied`, `payment_voided`, `allocations_reversed`, `historical_backfill`, `optional_charge_cancelled`.

Adding a new event type requires altering that check constraint.

Separately, `payment_finance_snapshots` preserves the balance context of each payment, and `legacy_migration_audits` records opening-balance migrations.

## 12. Reports consuming finance data

- `/dashboard/reports/fee-balances` — per-student outstanding, via `getFeeBalancesReport()`.
- `/dashboard/fees` — `FinanceDashboardSummary` cards and top debtors.
- `/dashboard` home — outstanding fees stat.
- `/dashboard/students/[id]` — the per-student fee statement and timeline.
- `/dashboard/settings/finance-migration` — administrator-only allocation migration readiness.

There is **no** income report, no expenditure tracking, no account balances, and no view of money the school holds. The finance module today answers "what do pupils owe?" and nothing about "what does the school have, and where did it go?".

## 13. What would break if the existing model were changed incorrectly

These are the load-bearing behaviours. The upgrade must preserve every one.

1. **`get_student_finance_summary` semantics.** `record_payment`, `void_payment`, `apply_available_credit`, `get_void_payment_preview`, the statement UI, and the balances report all read `outstanding_balance` from it. Redefining that field to exclude meals/uniforms would silently change the amount `record_payment` compares against in legacy mode, change what the balances report shows, and make historical `payment_finance_snapshots` inconsistent with live figures. **Any fee/additional split must be delivered as new fields, not by redefining this one.**
2. **Receipt numbering.** Sequence is derived by scanning existing receipt numbers. Anything that inserts into `payments` outside `record_payment` risks a duplicate receipt number.
3. **Payment immutability triggers.** New code that updates `payments` without the GUC will be rejected — correctly. New flows must go through the existing RPCs.
4. **Idempotency.** The partial unique index plus replay handling in `record_payment` is what stops double-charging a parent on a retry. It must not be bypassed.
5. **Charge unique indexes.** Four partial indexes depend on `charge_source` and on `term_id IS NULL` semantics. Adding columns is safe; changing those predicates is not.
6. **Allocation invariants.** `charge_active_allocated` and `payment_active_allocated` underpin outstanding and credit. A second allocation writer would corrupt both.
7. **`finance_event_audits` check constraint.** New audit events must extend it in a migration, or the insert fails at runtime.
8. **Snapshot immutability.** Receipts render from snapshots; recomputing them retroactively would rewrite history.

---

## Gaps this upgrade must close

| # | Gap |
|---|---|
| G1 | No concept of an internal fund, so income cannot be attributed to School Fees vs Uniforms vs Meals vs Tuck Shop. |
| G2 | No concept of a physical account, so the school cannot see what is in the bank, in mobile money, or in petty cash. |
| G3 | Mandatory school-fee balance is polluted by opted-in meal and uniform charges. |
| G4 | No expenditure tracking of any kind. |
| G5 | No petty cash. |
| G6 | No salary tracking, and no access control model for salary sensitivity. |
| G7 | No account-to-account transfers, so a bank-to-petty-cash movement cannot be recorded without looking like income or expense. |
| G8 | No general ledger, so non-student income (tuck shop takings, uniform sales to the public, donations) cannot be recorded at all. |
| G9 | Finance authorisation is a single role predicate with no granularity — a bursar and a headteacher are indistinguishable, and there is no way to restrict salary data. |
| G10 | No management-level financial reporting. |
