import { describe, expect, it } from "vitest";

import {
  accountDelta,
  expectedDirection,
  expenseEffect,
  incomeEffect,
  isTransfer,
  runningBalance,
  summariseEntries,
  totalNetPosition,
} from "./ledger-math";
import type { LedgerEntry } from "./types";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "e1",
    entryDate: "2026-09-01",
    entryType: "income",
    direction: "in",
    amount: 100,
    fundId: "f1",
    fundName: "Uniforms",
    accountId: "a1",
    accountName: "Bank",
    description: "Test",
    reference: null,
    payee: null,
    sourceType: "manual",
    sourceId: null,
    isReversal: false,
    reversedAt: null,
    reversalReason: null,
    accountDelta: 100,
    incomeEffect: 100,
    expenseEffect: 0,
    ...overrides,
  };
}

describe("account movement", () => {
  it("adds money in and removes money out", () => {
    expect(
      accountDelta({ entryType: "income", direction: "in", amount: 250.5 }),
    ).toBe(250.5);
    expect(
      accountDelta({ entryType: "expense", direction: "out", amount: 250.5 }),
    ).toBe(-250.5);
  });
});

describe("FIN-07: transfers are not income", () => {
  it("contributes nothing to income", () => {
    expect(
      incomeEffect({ entryType: "transfer_in", direction: "in", amount: 3000 }),
    ).toBe(0);
    expect(
      incomeEffect({
        entryType: "transfer_out",
        direction: "out",
        amount: 3000,
      }),
    ).toBe(0);
  });
});

describe("FIN-08: transfers are not expenditure", () => {
  it("contributes nothing to expenditure", () => {
    expect(
      expenseEffect({ entryType: "transfer_out", direction: "out", amount: 3000 }),
    ).toBe(0);
    expect(
      expenseEffect({ entryType: "transfer_in", direction: "in", amount: 3000 }),
    ).toBe(0);
  });

  it("a bank to petty cash transfer leaves both totals at zero", () => {
    const totals = summariseEntries([
      { entryType: "transfer_out", direction: "out", amount: 3000 },
      { entryType: "transfer_in", direction: "in", amount: 3000 },
    ]);
    expect(totals.income).toBe(0);
    expect(totals.expenditure).toBe(0);
    expect(totals.net).toBe(0);
  });
});

describe("reversals", () => {
  it("an income reversal subtracts from income", () => {
    expect(
      incomeEffect({ entryType: "income", direction: "out", amount: 800 }),
    ).toBe(-800);
  });

  it("an expense reversal subtracts from expenditure", () => {
    expect(
      expenseEffect({ entryType: "expense", direction: "in", amount: 800 }),
    ).toBe(-800);
  });

  it("nets to zero once reversed", () => {
    const totals = summariseEntries([
      { entryType: "income", direction: "in", amount: 1200 },
      { entryType: "income", direction: "out", amount: 1200 },
    ]);
    expect(totals.income).toBe(0);
  });

  it("flips the required direction", () => {
    expect(expectedDirection("income", false)).toBe("in");
    expect(expectedDirection("income", true)).toBe("out");
    expect(expectedDirection("expense", false)).toBe("out");
    expect(expectedDirection("expense", true)).toBe("in");
    expect(expectedDirection("transfer_out", true)).toBe("in");
    expect(expectedDirection("adjustment", false)).toBeNull();
  });
});

describe("transfer classification", () => {
  it("recognises both legs", () => {
    expect(isTransfer("transfer_in")).toBe(true);
    expect(isTransfer("transfer_out")).toBe(true);
    expect(isTransfer("income")).toBe(false);
    expect(isTransfer("expense")).toBe(false);
  });
});

describe("decimal safety", () => {
  it("does not drift when summing awkward amounts", () => {
    const totals = summariseEntries([
      { entryType: "income", direction: "in", amount: 0.1 },
      { entryType: "income", direction: "in", amount: 0.2 },
      { entryType: "expense", direction: "out", amount: 0.3 },
    ]);
    expect(totals.income).toBe(0.3);
    expect(totals.expenditure).toBe(0.3);
    expect(totals.net).toBe(0);
  });

  it("keeps a running balance exact across many small movements", () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      entry({
        id: `e${index}`,
        entryType: "expense",
        direction: "out",
        amount: 0.07,
        accountDelta: -0.07,
      }),
    );
    const rows = runningBalance(1, entries);
    expect(rows.at(-1)?.balance).toBe(0.3);
  });
});

describe("running balance", () => {
  it("starts from the opening balance and applies each movement", () => {
    const rows = runningBalance(500, [
      entry({ id: "a", accountDelta: 200 }),
      entry({ id: "b", accountDelta: -50 }),
    ]);
    expect(rows.map((row) => row.balance)).toEqual([700, 650]);
  });
});

describe("fund totals", () => {
  it("sums net positions without float drift", () => {
    expect(
      totalNetPosition([
        {
          id: "1",
          code: "UNIFORMS",
          name: "Uniforms",
          description: null,
          isSchoolFees: false,
          isActive: true,
          sortOrder: 1,
          studentIncome: 0.1,
          otherIncome: 0,
          totalIncome: 0.1,
          totalExpenditure: 0,
          netPosition: 0.1,
          salaryCostsOmitted: false,
          allocationsActive: true,
        },
        {
          id: "2",
          code: "MEALS",
          name: "Meals",
          description: null,
          isSchoolFees: false,
          isActive: true,
          sortOrder: 2,
          studentIncome: 0.2,
          otherIncome: 0,
          totalIncome: 0.2,
          totalExpenditure: 0,
          netPosition: 0.2,
          salaryCostsOmitted: false,
          allocationsActive: true,
        },
      ]),
    ).toBe(0.3);
  });
});
