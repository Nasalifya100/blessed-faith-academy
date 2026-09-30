import { fromNgwee, toNgwee } from "@/lib/money";

import type {
  FinanceDirection,
  FinanceEntryType,
  FundPosition,
  LedgerEntry,
} from "./types";

/**
 * Pure mirror of the generated columns on finance_ledger_entries.
 *
 * The database is authoritative; these helpers exist so the UI can subtotal a
 * list it already holds without a second round trip, and so the rules can be
 * tested directly. All arithmetic goes through integer ngwee.
 */

export interface LedgerEffectInput {
  entryType: FinanceEntryType;
  direction: FinanceDirection;
  amount: number;
}

function signed(amount: number, direction: FinanceDirection, positive: FinanceDirection): number {
  return direction === positive ? toNgwee(amount) : -toNgwee(amount);
}

/** How the entry moves the physical account it touches. */
export function accountDelta(entry: LedgerEffectInput): number {
  return fromNgwee(signed(entry.amount, entry.direction, "in"));
}

/** Income contribution. Transfers are always zero (FIN-07). */
export function incomeEffect(entry: LedgerEffectInput): number {
  if (entry.entryType !== "income") return 0;
  return fromNgwee(signed(entry.amount, entry.direction, "in"));
}

/** Expenditure contribution. Transfers are always zero (FIN-08). */
export function expenseEffect(entry: LedgerEffectInput): number {
  if (entry.entryType !== "expense") return 0;
  return fromNgwee(signed(entry.amount, entry.direction, "out"));
}

export function isTransfer(entryType: FinanceEntryType): boolean {
  return entryType === "transfer_in" || entryType === "transfer_out";
}

/** The direction a given entry type must carry, given whether it reverses. */
export function expectedDirection(
  entryType: FinanceEntryType,
  isReversal: boolean,
): FinanceDirection | null {
  const forward: Partial<Record<FinanceEntryType, FinanceDirection>> = {
    income: "in",
    transfer_in: "in",
    expense: "out",
    transfer_out: "out",
  };
  const base = forward[entryType];
  if (!base) return null;
  if (!isReversal) return base;
  return base === "in" ? "out" : "in";
}

export interface LedgerTotals {
  income: number;
  expenditure: number;
  net: number;
  transfersIn: number;
  transfersOut: number;
}

export function summariseEntries(
  entries: readonly LedgerEffectInput[],
): LedgerTotals {
  let income = 0;
  let expenditure = 0;
  let transfersIn = 0;
  let transfersOut = 0;

  for (const entry of entries) {
    income += toNgwee(incomeEffect(entry));
    expenditure += toNgwee(expenseEffect(entry));
    if (entry.entryType === "transfer_in") {
      transfersIn += toNgwee(entry.amount) * (entry.direction === "in" ? 1 : -1);
    }
    if (entry.entryType === "transfer_out") {
      transfersOut +=
        toNgwee(entry.amount) * (entry.direction === "out" ? 1 : -1);
    }
  }

  return {
    income: fromNgwee(income),
    expenditure: fromNgwee(expenditure),
    net: fromNgwee(income - expenditure),
    transfersIn: fromNgwee(transfersIn),
    transfersOut: fromNgwee(transfersOut),
  };
}

/** Running balance for an account statement, oldest entry first. */
export function runningBalance(
  openingBalance: number,
  entries: readonly LedgerEntry[],
): { entry: LedgerEntry; balance: number }[] {
  let balanceNgwee = toNgwee(openingBalance);
  return entries.map((entry) => {
    balanceNgwee += toNgwee(entry.accountDelta);
    return { entry, balance: fromNgwee(balanceNgwee) };
  });
}

/**
 * Physical balance after a counted opening.
 *
 * `openingBalanceDate` is the day the external statement or cash count was
 * true at end of day. `insideOpeningBalance` means that row already existed
 * and its cash is inside that count. Business dates stay on the row for
 * reports. They do not decide whether a later-recorded movement moves cash.
 *
 * Voiding a counted receipt does not remove cash. Void corrects the student
 * receipt and does not post money leaving the account. Voiding a receipt
 * recorded after the count removes it, because that receipt was the cash-in
 * record.
 */
export function physicalAccountBalance(input: {
  accountId: string;
  openingBalance: number;
  openingBalanceDate: string | null;
  ledger: readonly {
    entryDate: string;
    accountDelta: number;
    /** True when this row was already inside the counted opening balance. */
    insideOpeningBalance?: boolean;
  }[];
  receipts: readonly {
    paidOn: string;
    amount: number;
    accountId: string | null;
    status: "completed" | "voided";
    /** True when this receipt was already inside the counted opening balance. */
    insideOpeningBalance?: boolean;
  }[];
}): number {
  const counted = input.openingBalanceDate !== null;
  let ngwee = toNgwee(input.openingBalance);
  for (const entry of input.ledger) {
    if (counted && entry.insideOpeningBalance) continue;
    ngwee += toNgwee(entry.accountDelta);
  }
  for (const receipt of input.receipts) {
    if (receipt.accountId !== input.accountId) continue;
    if (counted && receipt.insideOpeningBalance) continue;
    if (receipt.status === "completed") ngwee += toNgwee(receipt.amount);
  }
  return fromNgwee(ngwee);
}

/**
 * actual verified cash minus the derived system balance.
 * A non-zero difference is reported. It is not posted as an adjustment.
 */
export function reconciliationDifference(
  verifiedAmount: number | null,
  systemAmount: number,
): number | null {
  if (verifiedAmount === null) return null;
  return fromNgwee(toNgwee(verifiedAmount) - toNgwee(systemAmount));
}

/** Fund net = student allocations + other income − expenditure. Transfers are absent. */
export function fundNetPosition(
  studentIncome: number,
  otherIncome: number,
  expenditure: number,
): number {
  return fromNgwee(
    toNgwee(studentIncome) + toNgwee(otherIncome) - toNgwee(expenditure),
  );
}

/**
 * Oldest-charge-first application. This is the legacy estimate only.
 * Once payment allocations exist, those stored amounts are authoritative
 * and this function must not be used to override them.
 */
export function allocateFifo(
  orderedCharges: readonly { id: string; amount: number }[],
  payment: number,
): Record<string, number> {
  let remaining = toNgwee(payment);
  const applied: Record<string, number> = {};
  for (const charge of orderedCharges) {
    const take = Math.min(toNgwee(charge.amount), Math.max(0, remaining));
    applied[charge.id] = fromNgwee(take);
    remaining -= take;
  }
  return applied;
}

const EXPENSE_TRANSITIONS: Record<string, readonly string[]> = {
  recorded: ["approved", "reversed"],
  approved: ["paid", "reversed"],
  paid: ["reversed"],
  reversed: [],
};

/** Null when the transition is allowed. Money moves only on recorded → approved → paid. */
export function expenseTransitionError(
  from: string,
  to: string,
): string | null {
  const allowed = EXPENSE_TRANSITIONS[from];
  if (!allowed) return `Unknown expense status ${from}.`;
  if (!allowed.includes(to)) {
    return `An expense cannot move from ${from} to ${to}.`;
  }
  return null;
}

export function totalNetPosition(funds: readonly FundPosition[]): number {
  let total = 0;
  for (const fund of funds) {
    total += toNgwee(fund.netPosition);
  }
  return fromNgwee(total);
}
