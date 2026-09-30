import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  activeChargeIdentity,
  fundIncomeFromStoredAllocations,
  mandatoryChargeConfirmationLines,
  previewNextPaymentAllocation,
  settleStudentCharges,
  studentActivityForFeeItem,
  summarizeProposedAllocation,
  type SettlementCharge,
} from "./billing-balances";
import { sqlTermSortKey, sqlYearSortKey, sortChargesOldestFirst } from "./payment-preview";

function charge(
  overrides: Partial<SettlementCharge> & Pick<SettlementCharge, "id" | "activity" | "amount">,
): SettlementCharge {
  return {
    label: overrides.activity ?? "Charge",
    storedAllocated: 0,
    yearId: "year-2026",
    yearName: "2026",
    yearStart: "2026-01-01",
    termName: "Term 1",
    termStart: "2026-01-13",
    termNumber: 1,
    createdAt: "2026-01-13T00:00:00Z",
    waived: false,
    ...overrides,
  };
}

const TERM_1 = {
  yearId: "year-2026",
  yearName: "2026",
  yearStart: "2026-01-01",
  termName: "Term 1",
  termStart: "2026-01-13",
  termNumber: 1,
};

describe("student activity mapping", () => {
  it("keeps mandatory tuition and extras in school fees", () => {
    expect(
      studentActivityForFeeItem({ category: "tuition", isOptional: false }),
    ).toBe("school_fees");
    expect(
      studentActivityForFeeItem({ category: "extra", isOptional: false }),
    ).toBe("school_fees");
  });

  it("keeps uniforms, meals, and optional extras out of school fees", () => {
    expect(
      studentActivityForFeeItem({ category: "uniform", isOptional: true }),
    ).toBe("uniforms");
    expect(
      studentActivityForFeeItem({ category: "meal", isOptional: true }),
    ).toBe("meals");
    expect(
      studentActivityForFeeItem({ category: "extra", isOptional: true }),
    ).toBe("other");
  });
});

describe("CASE A mandatory versus combined", () => {
  const charges = [
    charge({
      id: "fees",
      activity: "school_fees",
      label: "School Fees",
      amount: 1000,
      createdAt: "2026-01-13T00:00:01Z",
      ...TERM_1,
    }),
    charge({
      id: "uniforms",
      activity: "uniforms",
      label: "Uniforms",
      amount: 400,
      createdAt: "2026-01-13T00:00:02Z",
      ...TERM_1,
    }),
    charge({
      id: "meals",
      activity: "meals",
      label: "Meals",
      amount: 500,
      createdAt: "2026-01-13T00:00:03Z",
      ...TERM_1,
    }),
  ];

  it("reports school fees separately from the combined account", () => {
    const settled = settleStudentCharges({
      basis: "fifo_estimate",
      paymentsTotal: 0,
      currentYearId: "year-2026",
      charges,
    });
    expect(settled.mandatoryOutstanding).toBe(1000);
    expect(settled.combinedOutstanding).toBe(1900);
    expect(settled.activities.find((row) => row.activity === "uniforms")?.outstanding).toBe(400);
    expect(settled.activities.find((row) => row.activity === "meals")?.outstanding).toBe(500);
    expect(settled.previousOutstanding).toBe(0);
  });
});

describe("CASE B and C existing oldest-charge allocation", () => {
  const charges = [
    charge({
      id: "fees",
      activity: "school_fees",
      label: "School Fees",
      amount: 1000,
      createdAt: "2026-01-13T00:00:01Z",
    }),
    charge({
      id: "uniforms",
      activity: "uniforms",
      label: "Uniforms",
      amount: 400,
      createdAt: "2026-01-13T00:00:02Z",
    }),
    charge({
      id: "meals",
      activity: "meals",
      label: "Meals",
      amount: 500,
      createdAt: "2026-01-13T00:00:03Z",
    }),
  ];

  it("applies K600 to the oldest charge, which is school fees only because it was created first", () => {
    const preview = previewNextPaymentAllocation({
      basis: "fifo_estimate",
      paymentsAlreadyReceived: 0,
      nextPayment: 600,
      currentYearId: "year-2026",
      charges,
    });
    expect(preview.lines).toEqual([
      {
        chargeId: "fees",
        label: "School Fees",
        activity: "school_fees",
        amount: 600,
      },
    ]);
    expect(preview.unallocated).toBe(0);
  });

  it("follows created order for K1,500 when school fees, uniforms, then meals were created in that order", () => {
    const preview = previewNextPaymentAllocation({
      basis: "fifo_estimate",
      paymentsAlreadyReceived: 0,
      nextPayment: 1500,
      currentYearId: "year-2026",
      charges,
    });
    expect(preview.lines.map((line) => [line.activity, line.amount])).toEqual([
      ["school_fees", 1000],
      ["uniforms", 400],
      ["meals", 100],
    ]);
    const after = settleStudentCharges({
      basis: "fifo_estimate",
      paymentsTotal: 1500,
      currentYearId: "year-2026",
      charges,
    });
    expect(after.activities.find((row) => row.activity === "school_fees")?.outstanding).toBe(0);
    expect(after.activities.find((row) => row.activity === "uniforms")?.outstanding).toBe(0);
    expect(after.activities.find((row) => row.activity === "meals")?.outstanding).toBe(400);
    expect(after.combinedOutstanding).toBe(400);
  });

  it("does not prefer school fees when a meal charge is older", () => {
    const mealFirst = [
      charge({
        id: "meals",
        activity: "meals",
        amount: 500,
        createdAt: "2026-01-01T00:00:00Z",
      }),
      charge({
        id: "fees",
        activity: "school_fees",
        amount: 1000,
        createdAt: "2026-01-02T00:00:00Z",
      }),
    ];
    const preview = previewNextPaymentAllocation({
      basis: "fifo_estimate",
      paymentsAlreadyReceived: 0,
      nextPayment: 600,
      currentYearId: "year-2026",
      charges: mealFirst,
    });
    expect(preview.lines[0]?.activity).toBe("meals");
    expect(preview.lines[0]?.amount).toBe(500);
    expect(preview.lines[1]?.activity).toBe("school_fees");
    expect(preview.lines[1]?.amount).toBe(100);
  });
});

describe("CASE D physical account stays separate from fund attribution", () => {
  it("attributes a stored split without creating extra receipts", () => {
    const income = fundIncomeFromStoredAllocations([
      { activity: "school_fees", amount: 1000, reversed: false },
      { activity: "uniforms", amount: 400, reversed: false },
      { activity: "meals", amount: 100, reversed: false },
    ]);
    expect(income.school_fees).toBe(1000);
    expect(income.uniforms).toBe(400);
    expect(income.meals).toBe(100);
    expect(income.school_fees + income.uniforms + income.meals).toBe(1500);
  });
});

describe("CASE E previous-year debt stays on its year", () => {
  it("keeps a 2026 meal charge in 2026 when 2027 is current", () => {
    const settled = settleStudentCharges({
      basis: "allocations",
      paymentsTotal: 0,
      currentYearId: "year-2027",
      currentYearStart: "2027-01-01",
      charges: [
        charge({
          id: "old-meals",
          activity: "meals",
          amount: 400,
          yearId: "year-2026",
          yearName: "2026",
          yearStart: "2026-01-01",
          storedAllocated: 0,
        }),
        charge({
          id: "new-fees",
          activity: "school_fees",
          amount: 5400,
          yearId: "year-2027",
          yearName: "2027",
          yearStart: "2027-01-01",
          termName: "Term 1",
          termStart: "2027-01-13",
          createdAt: "2027-01-13T00:00:00Z",
        }),
      ],
    });
    expect(settled.previousOutstanding).toBe(400);
    expect(settled.currentYearOutstanding).toBe(5400);
    expect(settled.combinedOutstanding).toBe(5800);
    expect(settled.periods.find((period) => period.yearName === "2026")?.outstanding).toBe(400);
  });

  it("pays the older year first when both years are outstanding", () => {
    const preview = previewNextPaymentAllocation({
      basis: "fifo_estimate",
      paymentsAlreadyReceived: 0,
      nextPayment: 1000,
      currentYearId: "year-2027",
      currentYearStart: "2027-01-01",
      charges: [
        charge({
          id: "old",
          activity: "meals",
          amount: 400,
          yearId: "year-2026",
          yearName: "2026",
          yearStart: "2026-01-01",
        }),
        charge({
          id: "current",
          activity: "school_fees",
          amount: 5400,
          yearId: "year-2027",
          yearName: "2027",
          yearStart: "2027-01-01",
          createdAt: "2027-01-13T00:00:00Z",
        }),
      ],
    });
    expect(preview.lines.map((line) => [line.chargeId, line.amount])).toEqual([
      ["old", 400],
      ["current", 600],
    ]);
  });
});

describe("CASE F reversal", () => {
  it("drops reversed allocations from fund income and restores the charge", () => {
    const income = fundIncomeFromStoredAllocations([
      { activity: "uniforms", amount: 400, reversed: true },
    ]);
    expect(income.uniforms).toBe(0);

    const settled = settleStudentCharges({
      basis: "allocations",
      paymentsTotal: 400,
      currentYearId: "year-2026",
      charges: [
        charge({
          id: "uniforms",
          activity: "uniforms",
          amount: 400,
          storedAllocated: 0,
        }),
      ],
    });
    expect(settled.activities.find((row) => row.activity === "uniforms")?.outstanding).toBe(400);
  });
});

describe("CASE G duplicate charge identity", () => {
  it("treats the same student, fee item, and term as one active charge", () => {
    const first = activeChargeIdentity({
      studentId: "student",
      feeItemId: "tuition",
      academicYearId: "year-2026",
      termId: "term-1",
    });
    const retry = activeChargeIdentity({
      studentId: "student",
      feeItemId: "tuition",
      academicYearId: "year-2026",
      termId: "term-1",
    });
    const nextTerm = activeChargeIdentity({
      studentId: "student",
      feeItemId: "tuition",
      academicYearId: "year-2026",
      termId: "term-2",
    });
    expect(first).toBe(retry);
    expect(nextTerm).not.toBe(first);
  });

  it("keeps the database unique indexes that block a second active charge", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260716010300_charge_unique_indexes.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("charges_student_item_term_active_uidx");
    expect(sql).toContain("charges_student_item_year_active_uidx");
    expect(sql).toContain("where status <> 'cancelled'");
  });
});

describe("CASE H historical payments without allocations", () => {
  it("does not turn an unallocated receipt into fund income", () => {
    const income = fundIncomeFromStoredAllocations([]);
    expect(income).toEqual({
      school_fees: 0,
      uniforms: 0,
      meals: 0,
      other: 0,
    });
  });
});

describe("mandatory generation list", () => {
  it("excludes meals, uniforms, tuck-style optional items, and keeps term versus year wording", () => {
    const lines = mandatoryChargeConfirmationLines([
      {
        name: "School fees",
        category: "tuition",
        isOptional: false,
        billingFrequency: "term",
      },
      {
        name: "PTA fee",
        category: "extra",
        isOptional: false,
        billingFrequency: "year",
      },
      {
        name: "Meal allowance",
        category: "meal",
        isOptional: true,
        billingFrequency: "term",
      },
      {
        name: "Socks",
        category: "uniform",
        isOptional: true,
        billingFrequency: "once",
      },
      {
        name: "Tuck shop",
        category: "other",
        isOptional: true,
        billingFrequency: "once",
      },
    ]);
    expect(lines).toEqual([
      "School fees (this term)",
      "PTA fee (this academic year)",
    ]);
  });
});

describe("year charges and configured year names", () => {
  it("keeps a null term as a year charge and does not rename the academic year", () => {
    const settled = settleStudentCharges({
      basis: "fifo_estimate",
      paymentsTotal: 0,
      currentYearId: "year-next",
      charges: [
        charge({
          id: "pta",
          activity: "school_fees",
          amount: 150,
          yearId: "year-next",
          yearName: "Next year",
          yearStart: "2027-01-01",
          termName: null,
          termStart: null,
          termNumber: null,
        }),
        charge({
          id: "tuition",
          activity: "school_fees",
          amount: 1000,
          yearId: "year-next",
          yearName: "Next year",
          yearStart: "2027-01-01",
          termName: "First term",
          termStart: "2027-01-13",
          termNumber: 1,
          createdAt: "2027-01-13T00:00:00Z",
        }),
      ],
    });
    expect(settled.periods.map((period) => period.termName)).toEqual([
      "Year charges",
      "First term",
    ]);
    expect(settled.periods[0]?.isYearCharge).toBe(true);
    expect(settled.periods[1]?.isYearCharge).toBe(false);
    expect(settled.periods.every((period) => period.yearName === "Next year")).toBe(
      true,
    );
    expect(settled.previousOutstanding).toBe(0);
    expect(settled.currentYearOutstanding).toBe(1150);
  });
});

describe("activity balances without fund income", () => {
  it("puts a uniform charge on uniforms and a meal charge on meals", () => {
    const settled = settleStudentCharges({
      basis: "fifo_estimate",
      paymentsTotal: 0,
      currentYearId: "year-2026",
      charges: [
        charge({ id: "uniform", activity: "uniforms", amount: 400 }),
        charge({
          id: "meal",
          activity: "meals",
          amount: 500,
          createdAt: "2026-01-14T00:00:00Z",
        }),
      ],
    });
    expect(
      settled.activities.find((row) => row.activity === "uniforms")?.outstanding,
    ).toBe(400);
    expect(
      settled.activities.find((row) => row.activity === "meals")?.outstanding,
    ).toBe(500);
    expect(
      settled.activities.find((row) => row.activity === "other")?.outstanding,
    ).toBe(0);
  });

  it("does not treat an estimated meal or uniform settlement as fund income", () => {
    const income = fundIncomeFromStoredAllocations([]);
    expect(income.uniforms).toBe(0);
    expect(income.meals).toBe(0);

    const stored = fundIncomeFromStoredAllocations([
      { activity: "uniforms", amount: 400, reversed: false },
      { activity: "meals", amount: 100, reversed: false },
    ]);
    expect(stored.uniforms).toBe(400);
    expect(stored.meals).toBe(100);
  });
});

describe("payment preview summary", () => {
  it("groups the oldest-first result by activity", () => {
    const preview = previewNextPaymentAllocation({
      basis: "fifo_estimate",
      paymentsAlreadyReceived: 0,
      nextPayment: 1500,
      currentYearId: "year-2026",
      charges: [
        charge({
          id: "fees",
          activity: "school_fees",
          label: "School Fees",
          amount: 1000,
          createdAt: "2026-01-13T00:00:01Z",
        }),
        charge({
          id: "uniforms",
          activity: "uniforms",
          label: "Uniforms",
          amount: 400,
          createdAt: "2026-01-13T00:00:02Z",
        }),
        charge({
          id: "meals",
          activity: "meals",
          label: "Meals",
          amount: 500,
          createdAt: "2026-01-13T00:00:03Z",
        }),
      ],
    });
    expect(summarizeProposedAllocation(preview.lines)).toEqual([
      { activity: "school_fees", label: "School Fees", amount: 1000 },
      { activity: "uniforms", label: "Uniforms", amount: 400 },
      { activity: "meals", label: "Meals", amount: 100 },
    ]);
  });
});

describe("future academic year is not previous debt", () => {
  it("keeps a later non-current year out of previous outstanding", () => {
    const settled = settleStudentCharges({
      basis: "allocations",
      paymentsTotal: 0,
      currentYearId: "year-current",
      currentYearStart: "2026-01-01",
      charges: [
        charge({
          id: "current-fees",
          activity: "school_fees",
          amount: 1500,
          yearId: "year-current",
          yearName: "Academic Year 2026",
          yearStart: "2026-01-01",
        }),
        charge({
          id: "later-fees",
          activity: "school_fees",
          amount: 800,
          yearId: "year-later",
          yearName: "AY28",
          yearStart: "2028-01-01",
          createdAt: "2028-01-13T00:00:00Z",
        }),
      ],
    });
    expect(settled.currentYearOutstanding).toBe(1500);
    expect(settled.previousOutstanding).toBe(0);
    expect(settled.laterOutstanding).toBe(800);
    expect(settled.combinedOutstanding).toBe(2300);
    expect(settled.periods.find((period) => period.yearName === "AY28")?.yearName).toBe(
      "AY28",
    );
  });
});

describe("payment preview edges", () => {
  const charges = [
    charge({
      id: "fees",
      activity: "school_fees",
      amount: 1000,
      createdAt: "2026-01-13T00:00:01Z",
    }),
    charge({
      id: "uniforms",
      activity: "uniforms",
      amount: 400,
      createdAt: "2026-01-13T00:00:02Z",
    }),
  ];

  it("does not invent an allocation for zero, negative, or non-numeric amounts", () => {
    for (const nextPayment of [0, -20, Number.NaN]) {
      const preview = previewNextPaymentAllocation({
        basis: "fifo_estimate",
        paymentsAlreadyReceived: 0,
        nextPayment,
        currentYearId: "year-2026",
        currentYearStart: "2026-01-01",
        charges,
      });
      expect(preview.lines).toEqual([]);
      expect(preview.unallocated).toBe(0);
    }
  });

  it("leaves the surplus unallocated when the payment exceeds outstanding charges", () => {
    const preview = previewNextPaymentAllocation({
      basis: "fifo_estimate",
      paymentsAlreadyReceived: 0,
      nextPayment: 2000,
      currentYearId: "year-2026",
      currentYearStart: "2026-01-01",
      charges,
    });
    expect(summarizeProposedAllocation(preview.lines)).toEqual([
      { activity: "school_fees", label: "School Fees", amount: 1000 },
      { activity: "uniforms", label: "Uniforms", amount: 400 },
    ]);
    expect(preview.unallocated).toBe(600);
  });
});

describe("sql term sort key", () => {
  it("places a charge with no term before a dated term in the same year", () => {
    const sorted = sortChargesOldestFirst([
      {
        id: "term",
        yearStart: "2026-01-01",
        termStart: "2026-01-13",
        termNumber: 1,
        createdAt: "2026-01-13T00:00:00Z",
      },
      {
        id: "annual",
        yearStart: "2026-01-01",
        termStart: null,
        termNumber: null,
        createdAt: "2026-01-20T00:00:00Z",
      },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["annual", "term"]);
    expect(sqlTermSortKey(null, null)).toBe("2000-01-01");
    expect(sqlTermSortKey(null, 2)).toBe("2000-03-31");
  });

  it("orders years by start date, not by the display name", () => {
    const sorted = sortChargesOldestFirst([
      {
        id: "named-early",
        yearStart: "2028-01-01",
        termStart: "2028-01-13",
        termNumber: 1,
        createdAt: "2028-01-13T00:00:00Z",
      },
      {
        id: "named-later-alphabetically",
        yearStart: "2026-01-01",
        termStart: "2026-01-13",
        termNumber: 1,
        createdAt: "2026-01-13T00:00:00Z",
      },
    ]);
    expect(sorted.map((row) => row.id)).toEqual([
      "named-later-alphabetically",
      "named-early",
    ]);
  });

  it("uses the year created date when the start date is missing, then created_at, then id", () => {
    const sorted = sortChargesOldestFirst([
      {
        id: "b",
        yearStart: null,
        yearCreatedAt: "2024-06-01T00:00:00Z",
        termStart: "2024-06-01",
        termNumber: 1,
        createdAt: "2024-06-02T00:00:00Z",
      },
      {
        id: "a",
        yearStart: null,
        yearCreatedAt: "2024-06-01T00:00:00Z",
        termStart: "2024-06-01",
        termNumber: 1,
        createdAt: "2024-06-02T00:00:00Z",
      },
    ]);
    expect(sqlYearSortKey(null, "2024-06-01T10:00:00Z")).toBe("2024-06-01");
    expect(sorted.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
