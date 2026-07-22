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

/** Deterministic oldest-first sort for charge allocation previews/tests. */
export function sortChargesOldestFirst<
  T extends {
    id: string;
    yearStart: string | null;
    termStart: string | null;
    termNumber: number | null;
    createdAt: string;
  },
>(charges: T[]): T[] {
  return [...charges].sort((a, b) => {
    const yearA = a.yearStart ?? "9999-12-31";
    const yearB = b.yearStart ?? "9999-12-31";
    if (yearA !== yearB) return yearA.localeCompare(yearB);

    const termA =
      a.termStart ??
      (a.termNumber != null
        ? `2000-${String(((a.termNumber - 1) % 12) + 1).padStart(2, "0")}-01`
        : "9999-12-31");
    const termB =
      b.termStart ??
      (b.termNumber != null
        ? `2000-${String(((b.termNumber - 1) % 12) + 1).padStart(2, "0")}-01`
        : "9999-12-31");
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
