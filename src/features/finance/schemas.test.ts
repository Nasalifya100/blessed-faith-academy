import { describe, expect, it } from "vitest";

import {
  payExpenseSchema,
  recordExpenseSchema,
  recordFundIncomeSchema,
  recordSalarySchema,
  recordTransferSchema,
  reverseExpenseSchema,
  upsertAccountSchema,
} from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

describe("FIN-01: amounts are positive at the input boundary", () => {
  const base = {
    fundId: UUID_A,
    accountId: UUID_B,
    receivedOn: "2026-09-01",
    description: "Tuck shop takings",
    clientRequestId: UUID_C,
  };

  it("rejects zero", () => {
    expect(
      recordFundIncomeSchema.safeParse({ ...base, amount: 0 }).success,
    ).toBe(false);
  });

  it("rejects negatives", () => {
    expect(
      recordFundIncomeSchema.safeParse({ ...base, amount: -50 }).success,
    ).toBe(false);
  });

  it("rejects more than two decimal places", () => {
    expect(
      recordFundIncomeSchema.safeParse({ ...base, amount: 10.005 }).success,
    ).toBe(false);
  });

  it("accepts a normal amount", () => {
    expect(
      recordFundIncomeSchema.safeParse({ ...base, amount: 1250.75 }).success,
    ).toBe(true);
  });
});

describe("transfers", () => {
  const base = {
    fromAccountId: UUID_A,
    amount: 3000,
    transferDate: "2026-09-01",
    description: "Petty cash top-up",
    clientRequestId: UUID_C,
  };

  it("rejects moving money to the same account", () => {
    const result = recordTransferSchema.safeParse({
      ...base,
      toAccountId: UUID_A,
    });
    expect(result.success).toBe(false);
  });

  it("accepts two different accounts", () => {
    expect(
      recordTransferSchema.safeParse({ ...base, toAccountId: UUID_B }).success,
    ).toBe(true);
  });
});

describe("expenses", () => {
  const base = {
    categoryId: UUID_A,
    fundId: UUID_B,
    accountId: UUID_C,
    amount: 450,
    expenseDate: "2026-09-01",
    description: "Classroom door handles",
    clientRequestId: "44444444-4444-4444-8444-444444444444",
  };

  it("requires a meaningful description", () => {
    expect(
      recordExpenseSchema.safeParse({ ...base, description: "x" }).success,
    ).toBe(false);
  });

  it("accepts a valid expense", () => {
    expect(recordExpenseSchema.safeParse(base).success).toBe(true);
  });

  it("requires a paying account at payment time", () => {
    expect(
      payExpenseSchema.safeParse({
        expenseId: UUID_A,
        paidOn: "2026-09-02",
      }).success,
    ).toBe(false);
  });
});

describe("FIN-11: reversals always carry a reason", () => {
  it("rejects a blank reason", () => {
    expect(
      reverseExpenseSchema.safeParse({ expenseId: UUID_A, reason: "" }).success,
    ).toBe(false);
  });

  it("rejects a token reason", () => {
    expect(
      reverseExpenseSchema.safeParse({ expenseId: UUID_A, reason: "oops" })
        .success,
    ).toBe(false);
  });

  it("accepts an explanation", () => {
    expect(
      reverseExpenseSchema.safeParse({
        expenseId: UUID_A,
        reason: "Paid from the wrong account",
      }).success,
    ).toBe(true);
  });
});

describe("salaries", () => {
  const base = {
    staffId: UUID_A,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    periodLabel: "September 2026",
    grossAmount: 5000,
    deductionsAmount: 500,
  };

  it("accepts a well-formed record", () => {
    expect(recordSalarySchema.safeParse(base).success).toBe(true);
  });

  it("rejects deductions greater than gross", () => {
    expect(
      recordSalarySchema.safeParse({ ...base, deductionsAmount: 6000 }).success,
    ).toBe(false);
  });

  it("rejects a period that ends before it starts", () => {
    expect(
      recordSalarySchema.safeParse({
        ...base,
        periodStart: "2026-09-30",
        periodEnd: "2026-09-01",
      }).success,
    ).toBe(false);
  });

  it("rejects negative deductions", () => {
    expect(
      recordSalarySchema.safeParse({ ...base, deductionsAmount: -1 }).success,
    ).toBe(false);
  });
});

describe("accounts never store a full account number", () => {
  const base = {
    code: "BANK_TWO",
    name: "Second bank account",
    accountType: "bank" as const,
  };

  it("rejects a long reference that looks like a real account number", () => {
    expect(
      upsertAccountSchema.safeParse({
        ...base,
        maskedReference: "0123456789012345",
      }).success,
    ).toBe(false);
  });

  it("accepts a masked tail", () => {
    expect(
      upsertAccountSchema.safeParse({
        ...base,
        maskedReference: "****4321",
        openingBalanceDate: "2026-09-30",
      }).success,
    ).toBe(true);
  });

  it("rejects a negative opening balance", () => {
    expect(
      upsertAccountSchema.safeParse({ ...base, openingBalance: -10 }).success,
    ).toBe(false);
  });
});
