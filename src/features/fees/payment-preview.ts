import { fromNgwee, subKwacha, toNgwee } from "@/lib/money";

/** Preview helper — PostgreSQL remains authoritative for persisted amounts. */
export function previewPaymentApplication(input: {
  amountReceived: number;
  outstandingBalance: number;
}): {
  amountReceived: number;
  amountApplied: number;
  creditCreated: number;
  outstandingAfter: number;
  createsCredit: boolean;
  isAdvanceOnly: boolean;
} {
  const receivedNgwee = Math.max(0, toNgwee(input.amountReceived));
  const outstandingNgwee = Math.max(0, toNgwee(input.outstandingBalance));
  const appliedNgwee = Math.min(receivedNgwee, outstandingNgwee);
  const creditNgwee = receivedNgwee - appliedNgwee;
  const outstandingAfterNgwee = outstandingNgwee - appliedNgwee;

  return {
    amountReceived: fromNgwee(receivedNgwee),
    amountApplied: fromNgwee(appliedNgwee),
    creditCreated: fromNgwee(creditNgwee),
    outstandingAfter: fromNgwee(outstandingAfterNgwee),
    createsCredit: creditNgwee > 0,
    isAdvanceOnly: outstandingNgwee === 0 && receivedNgwee > 0,
  };
}

export function previewCreditApplication(input: {
  availableCredit: number;
  outstandingBalance: number;
}): {
  creditToApply: number;
  remainingCredit: number;
  remainingOutstanding: number;
} {
  const creditNgwee = Math.max(0, toNgwee(input.availableCredit));
  const outstandingNgwee = Math.max(0, toNgwee(input.outstandingBalance));
  const applyNgwee = Math.min(creditNgwee, outstandingNgwee);

  return {
    creditToApply: fromNgwee(applyNgwee),
    remainingCredit: fromNgwee(creditNgwee - applyNgwee),
    remainingOutstanding: fromNgwee(outstandingNgwee - applyNgwee),
  };
}

/**
 * Term ordering used by allocate_payment_to_charges:
 * start_date, otherwise 2000-01-01 plus (term_number - 1) * 90 days.
 * A charge with no term uses term_number 1, so it sorts before later terms.
 */
export function sqlTermSortKey(
  termStart: string | null,
  termNumber: number | null,
): string {
  if (termStart) return termStart;
  const term = termNumber ?? 1;
  const cursor = new Date(Date.UTC(2000, 0, 1));
  cursor.setUTCDate(cursor.getUTCDate() + (term - 1) * 90);
  return cursor.toISOString().slice(0, 10);
}

/**
 * Year ordering used by allocate_payment_to_charges:
 * academic year start_date, otherwise the year row's created date.
 * A missing date sorts last, matching nulls last.
 */
export function sqlYearSortKey(
  yearStart: string | null,
  yearCreatedAt?: string | null,
): string {
  if (yearStart) return yearStart;
  if (yearCreatedAt && yearCreatedAt.length >= 10) {
    return yearCreatedAt.slice(0, 10);
  }
  return "9999-12-31";
}

/** Deterministic oldest-first sort matching allocate_payment_to_charges. */
export function sortChargesOldestFirst<
  T extends {
    id: string;
    yearStart: string | null;
    yearCreatedAt?: string | null;
    termStart: string | null;
    termNumber: number | null;
    createdAt: string;
  },
>(charges: T[]): T[] {
  return [...charges].sort((a, b) => {
    const yearA = sqlYearSortKey(a.yearStart, a.yearCreatedAt);
    const yearB = sqlYearSortKey(b.yearStart, b.yearCreatedAt);
    if (yearA !== yearB) return yearA.localeCompare(yearB);

    const termA = sqlTermSortKey(a.termStart, a.termNumber);
    const termB = sqlTermSortKey(b.termStart, b.termNumber);
    if (termA !== termB) return termA.localeCompare(termB);

    if (a.createdAt !== b.createdAt) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    return a.id.localeCompare(b.id);
  });
}

/** Simulate FIFO allocation across charges using ngwee arithmetic. */
export function allocateAmountOldestFirst(
  amount: number,
  charges: Array<{ id: string; remaining: number }>,
): { allocations: Array<{ chargeId: string; amount: number }>; unallocated: number } {
  let remaining = toNgwee(amount);
  const allocations: Array<{ chargeId: string; amount: number }> = [];

  for (const charge of charges) {
    if (remaining <= 0) break;
    const chargeRemaining = Math.max(0, toNgwee(charge.remaining));
    if (chargeRemaining <= 0) continue;
    const apply = Math.min(remaining, chargeRemaining);
    allocations.push({ chargeId: charge.id, amount: fromNgwee(apply) });
    remaining -= apply;
  }

  return {
    allocations,
    unallocated: fromNgwee(remaining),
  };
}

export function availableCreditFromTotals(
  totalCompletedPayments: number,
  totalActiveAllocations: number,
): number {
  return Math.max(
    0,
    fromNgwee(
      toNgwee(totalCompletedPayments) - toNgwee(totalActiveAllocations),
    ),
  );
}

export function outstandingFromChargeRemainders(
  remainders: number[],
): number {
  return fromNgwee(
    remainders.reduce((sum, value) => sum + Math.max(0, toNgwee(value)), 0),
  );
}

export function netAccountPosition(
  outstanding: number,
  availableCredit: number,
): number {
  return subKwacha(outstanding, availableCredit);
}
