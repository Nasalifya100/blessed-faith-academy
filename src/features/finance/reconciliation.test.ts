import { describe, expect, it } from "vitest";

import {
  allocateFifo,
  expenseTransitionError,
  fundNetPosition,
  physicalAccountBalance,
  summariseEntries,
} from "./ledger-math";

const BANK = "bank";
const PETTY = "petty";

describe("physical account cutover does not double-count", () => {
  const historicalReceipts = [
    {
      paidOn: "2026-08-01",
      amount: 40000,
      accountId: null,
      status: "completed" as const,
    },
  ];

  it("keeps historical receipts inside the opening balance", () => {
    const balance = physicalAccountBalance({
      accountId: BANK,
      openingBalance: 50000,
      openingBalanceDate: "2026-09-30",
      ledger: [],
      receipts: [
        ...historicalReceipts,
        {
          paidOn: "2026-09-30",
          amount: 1000,
          accountId: BANK,
          status: "completed",
          insideOpeningBalance: true,
        },
        {
          paidOn: "2026-10-01",
          amount: 800,
          accountId: BANK,
          status: "completed",
        },
      ],
    });
    // 50,000 already includes August and 30 September. Only 1 October is added.
    expect(balance).toBe(50800);
  });

  it("does not treat a payment method as an account", () => {
    const balance = physicalAccountBalance({
      accountId: BANK,
      openingBalance: 0,
      openingBalanceDate: "2026-09-30",
      ledger: [],
      receipts: [
        {
          paidOn: "2026-10-02",
          amount: 500,
          accountId: null,
          status: "completed",
        },
        {
          paidOn: "2026-10-02",
          amount: 500,
          accountId: "mobile",
          status: "completed",
        },
      ],
    });
    expect(balance).toBe(0);
  });

  it("keeps a counted same-day receipt inside the opening balance", () => {
    expect(
      physicalAccountBalance({
        accountId: BANK,
        openingBalance: 20000,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [
          {
            paidOn: "2026-09-30",
            amount: 1000,
            accountId: BANK,
            status: "completed",
            insideOpeningBalance: true,
          },
        ],
      }),
    ).toBe(20000);
  });

  it("adds a receipt dated the day after cutover", () => {
    expect(
      physicalAccountBalance({
        accountId: BANK,
        openingBalance: 20000,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [
          {
            paidOn: "2026-10-01",
            amount: 1000,
            accountId: BANK,
            status: "completed",
          },
        ],
      }),
    ).toBe(21000);
  });

  it("moves cash on a transfer without calling it income or expenditure", () => {
    const bank = physicalAccountBalance({
      accountId: BANK,
      openingBalance: 20000,
      openingBalanceDate: "2026-09-30",
      ledger: [{ entryDate: "2026-10-01", accountDelta: -3000 }],
      receipts: [],
    });
    const petty = physicalAccountBalance({
      accountId: PETTY,
      openingBalance: 500,
      openingBalanceDate: "2026-09-30",
      ledger: [{ entryDate: "2026-10-01", accountDelta: 3000 }],
      receipts: [],
    });
    const movement = summariseEntries([
      { entryType: "transfer_out", direction: "out", amount: 3000 },
      { entryType: "transfer_in", direction: "in", amount: 3000 },
    ]);
    expect(bank).toBe(17000);
    expect(petty).toBe(3500);
    expect(movement.income).toBe(0);
    expect(movement.expenditure).toBe(0);
  });

  it("reduces petty cash by a later expense and counts that expense", () => {
    const petty = physicalAccountBalance({
      accountId: PETTY,
      openingBalance: 500,
      openingBalanceDate: "2026-09-30",
      ledger: [{ entryDate: "2026-10-01", accountDelta: -200 }],
      receipts: [],
    });
    const movement = summariseEntries([
      { entryType: "expense", direction: "out", amount: 200 },
    ]);
    expect(petty).toBe(300);
    expect(movement.expenditure).toBe(200);
    expect(movement.income).toBe(0);
  });

  it("leaves an unattributed receipt out of every physical account", () => {
    const receipt = {
      paidOn: "2026-10-01",
      amount: 500,
      accountId: null,
      status: "completed" as const,
    };
    expect(
      physicalAccountBalance({
        accountId: BANK,
        openingBalance: 20000,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [receipt],
      }),
    ).toBe(20000);
    expect(
      physicalAccountBalance({
        accountId: "mobile",
        openingBalance: 20000,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [receipt],
      }),
    ).toBe(20000);
    expect(
      physicalAccountBalance({
        accountId: PETTY,
        openingBalance: 500,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [receipt],
      }),
    ).toBe(500);
  });

  it("adds a receipt recorded after the count even when its date is the cutover day", () => {
    expect(
      physicalAccountBalance({
        accountId: BANK,
        openingBalance: 20000,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [
          {
            paidOn: "2026-09-30",
            amount: 1000,
            accountId: BANK,
            status: "completed",
          },
        ],
      }),
    ).toBe(21000);
  });

  it("drops a voided receipt", () => {
    expect(
      physicalAccountBalance({
        accountId: BANK,
        openingBalance: 100,
        openingBalanceDate: "2026-09-30",
        ledger: [],
        receipts: [
          {
            paidOn: "2026-10-03",
            amount: 40,
            accountId: BANK,
            status: "voided",
          },
        ],
      }),
    ).toBe(100);
  });
});

describe("fund position equation", () => {
  it("reconciles the worked example without counting the transfer", () => {
    const schoolFees = fundNetPosition(10000, 0, 0);
    const uniforms = fundNetPosition(2000, 0, 800);
    const meals = fundNetPosition(1500, 0, 900);
    const tuck = fundNetPosition(3000, 0, 1200);
    const general = fundNetPosition(0, 0, 4000);
    const pettyActivity = fundNetPosition(0, 0, 300);

    expect(schoolFees).toBe(10000);
    expect(uniforms).toBe(1200);
    expect(meals).toBe(600);
    expect(tuck).toBe(1800);
    expect(general).toBe(-4000);
    expect(pettyActivity).toBe(-300);

    const income = 10000 + 2000 + 1500 + 3000;
    const expenditure = 800 + 900 + 1200 + 4000 + 300;
    expect(income).toBe(16500);
    expect(expenditure).toBe(7200);
    expect(income - expenditure).toBe(9300);
    expect(
      schoolFees + uniforms + meals + tuck + general + pettyActivity,
    ).toBe(9300);

    const movements = summariseEntries([
      { entryType: "transfer_out", direction: "out", amount: 1000 },
      { entryType: "transfer_in", direction: "in", amount: 1000 },
      { entryType: "expense", direction: "out", amount: 300 },
    ]);
    expect(movements.income).toBe(0);
    expect(movements.expenditure).toBe(300);
    expect(movements.transfersOut).toBe(1000);
    expect(movements.transfersIn).toBe(1000);

    const bank = physicalAccountBalance({
      accountId: BANK,
      openingBalance: 20000,
      openingBalanceDate: "2026-09-30",
      ledger: [
        { entryDate: "2026-10-01", accountDelta: -1000 },
        { entryDate: "2026-10-02", accountDelta: -800 },
        { entryDate: "2026-10-02", accountDelta: -900 },
        { entryDate: "2026-10-02", accountDelta: -1200 },
        { entryDate: "2026-10-03", accountDelta: -4000 },
      ],
      receipts: [
        {
          paidOn: "2026-10-01",
          amount: 16500,
          accountId: BANK,
          status: "completed",
        },
      ],
    });
    // 20,000 + 16,500 student money − 1,000 transfer − 800 − 900 − 1,200 − 4,000
    expect(bank).toBe(28600);

    const petty = physicalAccountBalance({
      accountId: PETTY,
      openingBalance: 0,
      openingBalanceDate: "2026-09-30",
      ledger: [
        { entryDate: "2026-10-01", accountDelta: 1000 },
        { entryDate: "2026-10-04", accountDelta: -300 },
      ],
      receipts: [],
    });
    expect(petty).toBe(700);
  });
});

describe("payment allocation order", () => {
  const charges = [
    { id: "fees", amount: 1000 },
    { id: "uniforms", amount: 400 },
    { id: "meals", amount: 500 },
  ];

  it("applies K600 to the oldest charge only", () => {
    expect(allocateFifo(charges, 600)).toEqual({
      fees: 600,
      uniforms: 0,
      meals: 0,
    });
  });

  it("clears school fees at K1,000 and leaves the rest untouched", () => {
    expect(allocateFifo(charges, 1000)).toEqual({
      fees: 1000,
      uniforms: 0,
      meals: 0,
    });
  });

  it("reaches meals once fees and uniforms are cleared at K1,500", () => {
    expect(allocateFifo(charges, 1500)).toEqual({
      fees: 1000,
      uniforms: 400,
      meals: 100,
    });
  });

  it("clears every obligation at K1,900", () => {
    expect(allocateFifo(charges, 1900)).toEqual({
      fees: 1000,
      uniforms: 400,
      meals: 500,
    });
  });
});

describe("expense state machine", () => {
  it("allows recorded → approved → paid → reversed", () => {
    expect(expenseTransitionError("recorded", "approved")).toBeNull();
    expect(expenseTransitionError("approved", "paid")).toBeNull();
    expect(expenseTransitionError("paid", "reversed")).toBeNull();
  });

  it("rejects skipping approval, going backwards, and reversing twice", () => {
    expect(expenseTransitionError("recorded", "paid")).not.toBeNull();
    expect(expenseTransitionError("paid", "recorded")).not.toBeNull();
    expect(expenseTransitionError("reversed", "paid")).not.toBeNull();
    expect(expenseTransitionError("approved", "approved")).not.toBeNull();
  });

  it("allows an unpaid expense to be reversed without a second payment", () => {
    expect(expenseTransitionError("recorded", "reversed")).toBeNull();
    expect(expenseTransitionError("approved", "reversed")).toBeNull();
  });
});
