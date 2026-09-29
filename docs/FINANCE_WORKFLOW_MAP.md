# Finance — Workflow Map

Written for the people who will actually use this: the bursar, the head teacher, the secretary. No accounting background assumed.

---

## The words this system uses

| Word | What it means here |
|---|---|
| **Income** | Money coming *into* the school from outside it. Fees, uniform sales, tuck shop takings, donations. |
| **Expenditure** | Money going *out* of the school to someone else. Salaries, electricity, stock, repairs. |
| **Fund** | What the money is *for*: School Fees, Uniforms, Meals, Tuck Shop, Other. A fund is not a bank account. |
| **Physical account** | Where the money actually *is*: the bank, the mobile money wallet, the petty cash tin. |
| **Transfer** | Moving money the school already has from one of its own accounts to another. Not income. Not expenditure. |
| **Petty cash** | The small cash float kept at the school for day-to-day purchases. |
| **Outstanding receivable** | Money a family still owes the school in mandatory fees. |
| **Reversal** | The correct way to undo a mistake. The original record stays visible and a matching opposite record cancels it out. Nothing is ever deleted. |

---

## Where things live

```
Finance
├── Overview          income, expenditure, money held, what pupils still owe
├── School Fees       (existing Fees area: balances, charges, payments, receipts)
├── Funds             Uniforms · Meals · Tuck Shop · Other · School Fees
├── Expenses          record → approve → pay
├── Petty Cash        the cash float and what it was spent on
├── Salaries          restricted
├── Accounts          Bank · Mobile Money · Petty Cash, with balances
├── Transfers         moving money between the school's own accounts
└── Reports           filtered, printable, exportable
```

---

## Workflow 1 — A parent pays school fees

Unchanged. Use **Fees → student → Record payment**. A receipt number is issued, the payment is applied to the oldest charges first, and the pupil's balance drops.

The Finance overview picks this up automatically: the money appears as School Fees income, and it increases the Bank or Mobile Money balance depending on how it was paid.

## Workflow 2 — A parent buys a uniform

1. Opt the pupil into the uniform item in **Fees → student → Optional purchases**. That creates the charge.
2. Record the payment as normal in the Fees area so a receipt is issued.

On the pupil's page the amount appears under **Additional purchases**, *not* under mandatory school fees. In Finance it appears as income to the **Uniforms** fund.

**This is the change that matters most.** Previously a K900 uniform made a pupil who owed K1,000 in fees look like they owed K1,900. Now the two are shown apart.

## Workflow 3 — Tuck shop takings for the week

**Finance → Funds → Record income**

- What is it for: Tuck Shop
- Where was it received: Petty Cash (or Mobile Money)
- Amount, date, description

There is no pupil and no receipt, because this is not a fee. School fee money cannot be entered this way — the system refuses it and tells you to record a student payment instead, so a receipt is always issued.

## Workflow 4 — Buying tuck shop stock

**Finance → Expenses → Record expense**

- Category: Tuck Shop Stock
- Fund: Tuck Shop (suggested automatically)
- Account that will pay: Petty Cash
- Amount, date, description, who it is paid to

The expense is now **Recorded**. It has not moved any money yet.

Then:

1. **Approve** — someone other than the person who recorded it confirms it. (An administrator can approve their own, everyone else cannot.)
2. **Mark as paid** — choose the paying account and the date. *This* is the moment money leaves petty cash.

The Tuck Shop fund now shows both the takings and the stock cost, so the school can see whether the tuck shop is actually making money.

## Workflow 5 — Topping up petty cash from the bank

**Finance → Petty Cash → Move money between accounts** (or Finance → Transfers)

- From: Bank
- To: Petty Cash
- Amount: K3,000

Bank falls by K3,000. Petty cash rises by K3,000. **Total expenditure does not change at all**, because the school has not spent anything — the money has only moved. It becomes expenditure later, when it is actually spent on something.

## Workflow 6 — Paying a salary

**Finance → Salaries → Prepare salary**

1. **Prepare** — choose the staff member, the pay period, the gross amount and any deductions. The record is a **Draft**. Net pay is calculated by the database.
2. **Approve** — the head teacher or administrator approves. A bursar deliberately cannot approve salaries they prepare and pay.
3. **Mark as paid** — choose the paying account and date. The money leaves that account and is recorded as expenditure.

Only one live salary record is allowed per staff member per pay period, so the same person cannot be paid twice for September by accident.

Salary figures are visible **only** to the administrator, head teacher, and bursar. Teachers and the secretary cannot see them at all, and they are excluded from general financial exports.

## Workflow 7 — Fixing a mistake

There is no Delete button anywhere in Finance. That is deliberate.

**Reverse** the transaction instead:

1. Open the record and choose **Reverse**.
2. Give a reason. It is required, and it is stored.
3. Confirm.

What happens: the original stays visible, marked as reversed, and a matching opposite entry cancels its effect. Anyone reviewing the books later can see what was recorded, what was corrected, who corrected it, when, and why.

A transaction can only be reversed once, and a reversal cannot itself be reversed.

---

## Lifecycles at a glance

**Expense**

```
Recorded ──approve──► Approved ──pay──► Paid
    │                     │               │
    └───────── reverse ───┴───────────────┴──► Reversed
```

Money moves only on **pay**.

**Salary**

```
Draft ──approve──► Approved ──pay──► Paid
   │                   │              │
   └──────── reverse ──┴──────────────┴──► Reversed
```

**Transfer**

```
Completed ──reverse──► Reversed     (both legs together)
```

**Student payment** (unchanged)

```
Completed ──reverse──► Voided       (receipt stays on file)
```

---

## Two things to keep straight

**A fund balance is not cash.** "Uniforms net position K4,200" means uniform sales have exceeded uniform costs by K4,200 — not that K4,200 is sitting anywhere. What the school can actually spend is on the **Accounts** page.

**A transfer is not spending.** Moving K3,000 from the bank to the tin has not cost the school anything. The expenditure happens when that cash is used.

**The combined student account is not the school-fee balance.** A pupil can owe K1,000 in mandatory fees and K900 for a uniform. The student page shows K1,000 as mandatory school fees. Receipts and the fee-balances report show the combined K1,900, and they say so. The receipt snapshot is the combined figure at the time and is never rewritten.

**A payment method is not an account.** New receipts name the bank, mobile-money wallet, or cash tin that received the money. Older receipts have no account. They stay out of every balance, because the opening balance already includes them once the cutover date is set.
