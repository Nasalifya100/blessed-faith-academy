import { fromNgwee, toNgwee } from "@/lib/money";

import {
  allocateAmountOldestFirst,
  sortChargesOldestFirst,
} from "./payment-preview";

export type SettlementBasis = "allocations" | "fifo_estimate";

export type StudentActivity =
  | "school_fees"
  | "uniforms"
  | "meals"
  | "other";

export interface SettlementCharge {
  id: string;
  label: string;
  activity: StudentActivity;
  amount: number;
  storedAllocated: number;
  yearId: string;
  yearName: string | null;
  yearStart: string | null;
  /** Used only when yearStart is missing, matching coalesce(start_date, created_at::date). */
  yearCreatedAt?: string | null;
  termName: string | null;
  termStart: string | null;
  termNumber: number | null;
  createdAt: string;
  waived: boolean;
}

const ACTIVITY_LABELS: Record<StudentActivity, string> = {
  school_fees: "School Fees",
  uniforms: "Uniforms",
  meals: "Meals",
  other: "Other",
};

/**
 * Same fund mapping the deployed fee-item backfill uses.
 * Optional extras stay out of mandatory school fees.
 */
export function studentActivityForFeeItem(input: {
  category: string;
  isOptional: boolean;
}): StudentActivity {
  if (input.category === "uniform") return "uniforms";
  if (input.category === "meal") return "meals";
  if (input.category === "tuition") return "school_fees";
  if (input.category === "extra" && !input.isOptional) return "school_fees";
  return "other";
}

/**
 * Active-charge identity enforced by the partial unique indexes.
 * Term charges: student + fee item + term.
 * Year charges (no term): student + fee item + academic year.
 */
export function activeChargeIdentity(input: {
  studentId: string;
  feeItemId: string;
  academicYearId: string;
  termId: string | null;
}): string {
  if (input.termId) {
    return `${input.studentId}|${input.feeItemId}|term:${input.termId}`;
  }
  return `${input.studentId}|${input.feeItemId}|year:${input.academicYearId}`;
}

export interface ActivityOutstanding {
  activity: StudentActivity;
  label: string;
  outstanding: number;
}

export interface PeriodOutstanding {
  yearId: string;
  yearName: string;
  /** True when the charge has no term. Shown as year charges, not a term. */
  isYearCharge: boolean;
  termName: string;
  outstanding: number;
}

export interface StudentSettlement {
  basis: SettlementBasis;
  combinedOutstanding: number;
  mandatoryOutstanding: number;
  currentYearOutstanding: number;
  previousOutstanding: number;
  laterOutstanding: number;
  undatedOutstanding: number;
  activities: ActivityOutstanding[];
  periods: PeriodOutstanding[];
  byChargeId: Map<string, number>;
}

function chargeOutstandingNgwee(
  charge: SettlementCharge,
  basis: SettlementBasis,
  fifoPaidNgwee: number,
): number {
  if (charge.waived) return 0;
  const amount = Math.max(0, toNgwee(charge.amount));
  const paid =
    basis === "allocations"
      ? Math.min(amount, Math.max(0, toNgwee(charge.storedAllocated)))
      : Math.min(amount, Math.max(0, fifoPaidNgwee));
  return amount - paid;
}

export function settleStudentCharges(input: {
  basis: SettlementBasis;
  paymentsTotal: number;
  currentYearId: string | null;
  /** Start date of the configured current academic year. Not the display name. */
  currentYearStart?: string | null;
  charges: SettlementCharge[];
}): StudentSettlement {
  const active = input.charges.filter((charge) => !charge.waived);
  const ordered = sortChargesOldestFirst(active);
  const fifo =
    input.basis === "fifo_estimate"
      ? allocateAmountOldestFirst(
          input.paymentsTotal,
          ordered.map((charge) => ({
            id: charge.id,
            remaining: charge.amount,
          })),
        )
      : null;
  const fifoPaid = new Map(
    (fifo?.allocations ?? []).map((row) => [row.chargeId, toNgwee(row.amount)]),
  );

  const byChargeId = new Map<string, number>();
  const activityNgwee = new Map<StudentActivity, number>();
  const periodNgwee = new Map<
    string,
    {
      yearId: string;
      yearName: string;
      isYearCharge: boolean;
      termName: string;
      ngwee: number;
    }
  >();
  let currentYear = 0;
  let previous = 0;
  let later = 0;
  let undated = 0;

  for (const charge of ordered) {
    const outstanding = chargeOutstandingNgwee(
      charge,
      input.basis,
      fifoPaid.get(charge.id) ?? 0,
    );
    byChargeId.set(charge.id, outstanding);
    activityNgwee.set(
      charge.activity,
      (activityNgwee.get(charge.activity) ?? 0) + outstanding,
    );

    const yearName = charge.yearName?.trim() || "Academic year";
    const isYearCharge = !charge.termName;
    const termName = isYearCharge ? "Year charges" : charge.termName!;
    const periodKey = `${charge.yearId}|${isYearCharge ? "year" : termName}`;
    const period = periodNgwee.get(periodKey) ?? {
      yearId: charge.yearId,
      yearName,
      isYearCharge,
      termName,
      ngwee: 0,
    };
    period.ngwee += outstanding;
    periodNgwee.set(periodKey, period);

    if (input.currentYearId && charge.yearId === input.currentYearId) {
      currentYear += outstanding;
    } else if (
      input.currentYearStart &&
      charge.yearStart &&
      charge.yearStart < input.currentYearStart
    ) {
      previous += outstanding;
    } else if (
      input.currentYearStart &&
      charge.yearStart &&
      charge.yearStart > input.currentYearStart
    ) {
      later += outstanding;
    } else {
      undated += outstanding;
    }
  }

  const activities = (
    ["school_fees", "uniforms", "meals", "other"] as const
  ).map((activity) => ({
    activity,
    label: ACTIVITY_LABELS[activity],
    outstanding: fromNgwee(activityNgwee.get(activity) ?? 0),
  }));

  const combined = activities.reduce(
    (sum, row) => sum + toNgwee(row.outstanding),
    0,
  );

  return {
    basis: input.basis,
    combinedOutstanding: fromNgwee(combined),
    mandatoryOutstanding: fromNgwee(activityNgwee.get("school_fees") ?? 0),
    currentYearOutstanding: fromNgwee(currentYear),
    previousOutstanding: fromNgwee(previous),
    laterOutstanding: fromNgwee(later),
    undatedOutstanding: fromNgwee(undated),
    activities,
    periods: [...periodNgwee.values()].map((period) => ({
      yearId: period.yearId,
      yearName: period.yearName,
      isYearCharge: period.isYearCharge,
      termName: period.termName,
      outstanding: fromNgwee(period.ngwee),
    })),
    byChargeId,
  };
}

export interface ProposedAllocationLine {
  chargeId: string;
  label: string;
  activity: StudentActivity;
  amount: number;
}

/**
 * Preview of the existing oldest-charge rule for one new payment.
 * Does not write allocations. Callers must label fifo_estimate results
 * as estimates.
 */
export function previewNextPaymentAllocation(input: {
  basis: SettlementBasis;
  paymentsAlreadyReceived: number;
  nextPayment: number;
  currentYearId: string | null;
  currentYearStart?: string | null;
  charges: SettlementCharge[];
}): { lines: ProposedAllocationLine[]; unallocated: number } {
  const nextNgwee = Math.max(0, toNgwee(input.nextPayment));
  if (nextNgwee === 0) return { lines: [], unallocated: 0 };

  if (input.basis === "allocations") {
    const settled = settleStudentCharges({
      basis: input.basis,
      paymentsTotal: 0,
      currentYearId: input.currentYearId,
      currentYearStart: input.currentYearStart,
      charges: input.charges,
    });
    const ordered = sortChargesOldestFirst(
      input.charges.filter((charge) => !charge.waived),
    );
    const applied = allocateAmountOldestFirst(
      input.nextPayment,
      ordered.map((charge) => ({
        id: charge.id,
        remaining: fromNgwee(settled.byChargeId.get(charge.id) ?? 0),
      })),
    );
    return {
      lines: applied.allocations
        .filter((row) => toNgwee(row.amount) > 0)
        .map((row) => {
          const charge = ordered.find((item) => item.id === row.chargeId);
          return {
            chargeId: row.chargeId,
            label: charge?.label ?? "Charge",
            activity: charge?.activity ?? "other",
            amount: row.amount,
          };
        }),
      unallocated: applied.unallocated,
    };
  }

  const before = settleStudentCharges({
    basis: input.basis,
    paymentsTotal: input.paymentsAlreadyReceived,
    currentYearId: input.currentYearId,
    currentYearStart: input.currentYearStart,
    charges: input.charges,
  });
  const after = settleStudentCharges({
    basis: input.basis,
    paymentsTotal: fromNgwee(
      toNgwee(input.paymentsAlreadyReceived) + toNgwee(input.nextPayment),
    ),
    currentYearId: input.currentYearId,
    currentYearStart: input.currentYearStart,
    charges: input.charges,
  });
  const ordered = sortChargesOldestFirst(
    input.charges.filter((charge) => !charge.waived),
  );
  const lines: ProposedAllocationLine[] = [];
  let appliedNgwee = 0;
  for (const charge of ordered) {
    const delta =
      (before.byChargeId.get(charge.id) ?? 0) -
      (after.byChargeId.get(charge.id) ?? 0);
    if (delta <= 0) continue;
    appliedNgwee += delta;
    lines.push({
      chargeId: charge.id,
      label: charge.label,
      activity: charge.activity,
      amount: fromNgwee(delta),
    });
  }
  return {
    lines,
    unallocated: fromNgwee(Math.max(0, nextNgwee - appliedNgwee)),
  };
}

/**
 * Fund income may only be taken from stored, unreversed allocations.
 * A FIFO estimate is not accounting truth.
 */
const ACTIVITY_ORDER: StudentActivity[] = [
  "school_fees",
  "uniforms",
  "meals",
  "other",
];

/** Group a payment preview by activity. Omits activities that receive nothing. */
export function summarizeProposedAllocation(
  lines: ProposedAllocationLine[],
): Array<{ activity: StudentActivity; label: string; amount: number }> {
  const ngwee = new Map<StudentActivity, number>();
  for (const line of lines) {
    ngwee.set(line.activity, (ngwee.get(line.activity) ?? 0) + toNgwee(line.amount));
  }
  return ACTIVITY_ORDER.filter((activity) => (ngwee.get(activity) ?? 0) > 0).map(
    (activity) => ({
      activity,
      label: ACTIVITY_LABELS[activity],
      amount: fromNgwee(ngwee.get(activity) ?? 0),
    }),
  );
}

/**
 * Labels for the mandatory generate-charges confirmation.
 * Meals, uniforms, and optional items are excluded.
 */
export function mandatoryChargeConfirmationLines(
  items: Array<{
    name: string;
    category: string;
    isOptional: boolean;
    billingFrequency: string;
    isActive?: boolean;
  }>,
): string[] {
  return items
    .filter(
      (item) =>
        item.isActive !== false &&
        !item.isOptional &&
        item.category !== "meal" &&
        item.category !== "uniform",
    )
    .map((item) => {
      const timing =
        item.billingFrequency === "term" ? "this term" : "this academic year";
      return `${item.name} (${timing})`;
    });
}

export function fundIncomeFromStoredAllocations(
  allocations: Array<{
    activity: StudentActivity;
    amount: number;
    reversed: boolean;
  }>,
): Record<StudentActivity, number> {
  const totals: Record<StudentActivity, number> = {
    school_fees: 0,
    uniforms: 0,
    meals: 0,
    other: 0,
  };
  const ngwee: Record<StudentActivity, number> = {
    school_fees: 0,
    uniforms: 0,
    meals: 0,
    other: 0,
  };
  for (const allocation of allocations) {
    if (allocation.reversed) continue;
    ngwee[allocation.activity] += Math.max(0, toNgwee(allocation.amount));
  }
  for (const activity of Object.keys(totals) as StudentActivity[]) {
    totals[activity] = fromNgwee(ngwee[activity]);
  }
  return totals;
}
