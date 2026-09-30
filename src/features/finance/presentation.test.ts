import { describe, expect, it } from "vitest";

import {
  ACTIVITY_RECENT_LIMIT,
  activityEmptyDescription,
  activityHref,
  activityIncomeDescription,
  contextualFundId,
  financeNavItems,
  lusakaDate,
  moneyHeldReady,
  monthStart,
  openingBalanceConfigured,
  openingBalanceSetupBlocked,
  OPERATIONAL_ACTIVITIES,
  primaryPettyCashAccount,
  suggestedCategoryId,
  transactionStatusLabel,
} from "./presentation";
import {
  addPettyCashSchema,
  recordActivityIncomeSchema,
} from "./schemas";

describe("finance staff navigation", () => {
  it("puts tuck shop, uniforms, and meals ahead of account setup for a bursar", () => {
    const labels = financeNavItems("bursar").map((item) => item.label);
    expect(labels.indexOf("Tuck Shop")).toBeGreaterThan(labels.indexOf("School Fees"));
    expect(labels.indexOf("Uniforms")).toBeLessThan(labels.indexOf("Money held"));
    expect(labels.indexOf("Meals")).toBeLessThan(labels.indexOf("Funds"));
    expect(labels).toContain("Expenses");
    expect(labels).toContain("Salaries");
    expect(labels).not.toContain("Post Ledger Entry");
  });

  it("shows a secretary the activity pages and hides salary and expense recording", () => {
    const labels = financeNavItems("secretary").map((item) => item.label);
    expect(labels).toEqual([
      "Overview",
      "School Fees",
      "Uniforms",
      "Meals",
      "Tuck Shop",
      "Funds",
    ]);
  });

  it("gives a teacher no finance workspace", () => {
    expect(financeNavItems("teacher")).toEqual([]);
  });
});

describe("activity recording context", () => {
  it("sends tuck shop, uniforms, and meals to their own pages", () => {
    expect(activityHref("TUCK_SHOP")).toBe("/dashboard/finance/tuck-shop");
    expect(activityHref("UNIFORMS")).toBe("/dashboard/finance/uniforms");
    expect(activityHref("MEALS")).toBe("/dashboard/finance/meals");
    expect(activityHref("SCHOOL_FEES")).toBe("/dashboard/fees");
  });

  it("uses notes when the bursar wrote them, otherwise the activity name", () => {
    expect(activityIncomeDescription("Friday sales", "Tuck shop sales")).toBe(
      "Friday sales",
    );
    expect(activityIncomeDescription("  ", "Tuck shop sales")).toBe(
      "Tuck shop sales",
    );
  });

  it("suggests tuck shop stock without forcing that category", () => {
    const categories = [
      { id: "stock", code: "TUCK_SHOP_STOCK", isActive: true, isSalary: false },
      { id: "food", code: "FOOD_CATERING", isActive: true, isSalary: false },
    ];
    expect(suggestedCategoryId(categories, "TUCK_SHOP_STOCK")).toBe("stock");
    expect(suggestedCategoryId(categories, "MISSING")).toBe("");
  });
});

describe("money held presentation", () => {
  it("refuses a total while any active account has no opening date", () => {
    expect(
      moneyHeldReady([
        { isActive: true, openingBalanceDate: "2026-09-30" },
        { isActive: true, openingBalanceDate: null },
      ]),
    ).toBe(false);
    expect(
      moneyHeldReady([
        { isActive: true, openingBalanceDate: "2026-09-30" },
        { isActive: false, openingBalanceDate: null },
      ]),
    ).toBe(true);
    expect(openingBalanceConfigured({ openingBalanceDate: null })).toBe(false);
  });

  it("blocks the first opening balance once attributed activity exists", () => {
    expect(
      openingBalanceSetupBlocked({
        openingBalanceDate: null,
        assignedReceipts: 31000,
        ledgerMovement: 0,
      }),
    ).toBe(true);
    expect(
      openingBalanceSetupBlocked({
        openingBalanceDate: null,
        assignedReceipts: 0,
        ledgerMovement: 0,
      }),
    ).toBe(false);
    expect(
      openingBalanceSetupBlocked({
        openingBalanceDate: "2026-09-30",
        assignedReceipts: 1000,
        ledgerMovement: 0,
      }),
    ).toBe(false);
  });
});

describe("contextual recording authority", () => {
  const funds = [
    { id: "tuck", code: "TUCK_SHOP", isActive: true, isSchoolFees: false },
    { id: "meals", code: "MEALS", isActive: true, isSchoolFees: false },
    { id: "fees", code: "SCHOOL_FEES", isActive: true, isSchoolFees: true },
    { id: "old", code: "UNIFORMS", isActive: false, isSchoolFees: false },
  ];

  it("resolves Tuck Shop from the activity code and ignores any other fund id", () => {
    expect(contextualFundId(funds, "TUCK_SHOP")).toBe("tuck");
    expect(contextualFundId(funds, "MEALS")).toBe("meals");
    expect(contextualFundId(funds, "SCHOOL_FEES")).toBeNull();
    expect(contextualFundId(funds, "UNIFORMS")).toBeNull();
    expect(contextualFundId(funds, "GENERAL")).toBeNull();
  });

  it("refuses an ambiguous activity match", () => {
    expect(
      contextualFundId(
        [
          ...funds,
          { id: "tuck-2", code: "TUCK_SHOP", isActive: true, isSchoolFees: false },
        ],
        "TUCK_SHOP",
      ),
    ).toBeNull();
  });

  it("does not accept a fund id on the contextual income schema", () => {
    const parsed = recordActivityIncomeSchema.safeParse({
      activityCode: "TUCK_SHOP",
      fundId: "11111111-1111-4111-8111-111111111111",
      accountId: "22222222-2222-4222-8222-222222222222",
      amount: 500,
      receivedOn: "2026-09-30",
      description: "Tuck shop sales",
      clientRequestId: "33333333-3333-4333-8333-333333333333",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.activityCode).toBe("TUCK_SHOP");
      expect("fundId" in parsed.data).toBe(false);
    }
  });

  it("does not accept a destination account on a petty-cash top-up", () => {
    const parsed = addPettyCashSchema.safeParse({
      fromAccountId: "22222222-2222-4222-8222-222222222222",
      toAccountId: "44444444-4444-4444-8444-444444444444",
      amount: 2000,
      transferDate: "2026-09-30",
      description: "Petty cash top-up",
      clientRequestId: "33333333-3333-4333-8333-333333333333",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("toAccountId" in parsed.data).toBe(false);
    }
  });

  it("chooses the active petty-cash account and skips inactive ones", () => {
    const chosen = primaryPettyCashAccount([
      { id: "bank", accountType: "bank", isActive: true, sortOrder: 1 },
      { id: "old-cash", accountType: "petty_cash", isActive: false, sortOrder: 1 },
      { id: "cash", accountType: "petty_cash", isActive: true, sortOrder: 2 },
    ]);
    expect(chosen?.id).toBe("cash");
  });
});

describe("activity empty states and reversals", () => {
  const tuckShop = OPERATIONAL_ACTIVITIES.find((item) => item.code === "TUCK_SHOP");

  it("does not invite a secretary to record tuck shop sales", () => {
    expect(tuckShop).toBeDefined();
    if (!tuckShop) return;
    expect(activityEmptyDescription(tuckShop, false)).toBe(
      "Tuck Shop has no recorded activity yet.",
    );
    expect(activityEmptyDescription(tuckShop, true)).toContain("sales");
  });

  it("labels a reversed sale as reversed, not as a second sale", () => {
    expect(
      transactionStatusLabel({
        entryType: "income",
        isReversal: false,
        reversedAt: "2026-09-30",
      }),
    ).toBe("Reversed · Income");
    expect(
      transactionStatusLabel({
        entryType: "income",
        isReversal: true,
        reversedAt: null,
      }),
    ).toBe("Reversal · Income");
  });

  it("keeps recent activity bounded", () => {
    expect(ACTIVITY_RECENT_LIMIT).toBeLessThanOrEqual(100);
    expect(ACTIVITY_RECENT_LIMIT).toBeGreaterThan(0);
  });
});

describe("school calendar dates", () => {
  it("uses the Lusaka calendar day and the first of that month", () => {
    const evening = new Date("2026-09-30T22:30:00.000Z");
    expect(lusakaDate(evening)).toBe("2026-10-01");
    expect(lusakaDate(new Date("2026-09-30T21:59:00.000Z"))).toBe("2026-09-30");
    expect(lusakaDate(new Date("2026-09-30T22:00:00.000Z"))).toBe("2026-10-01");
    expect(monthStart("2026-10-01")).toBe("2026-10-01");
    expect(monthStart("2026-09-30")).toBe("2026-09-01");
  });
});
