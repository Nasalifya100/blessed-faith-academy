import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  accountDelta,
  expenseEffect,
  incomeEffect,
  physicalAccountBalance,
  reconciliationDifference,
} from "@/features/finance/ledger-math";
import {
  formatCutoverDate,
  moneyHeldAccountState,
} from "@/features/finance/presentation";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260930200000_financial_account_opening_initialization.sql",
  ),
  "utf8",
).replace(/--.*$/gm, "");

const initializer = sql.slice(
  sql.indexOf("function public.initialize_school_opening_balances"),
  sql.indexOf("function public.correct_payment_paid_on"),
);

describe("verified starting balance", () => {
  it("is one-time, locked, and refused to ordinary edits and portal roles", () => {
    expect(initializer.indexOf("finance_lock_financial_accounts")).toBeLessThan(
      initializer.indexOf("This school already has a starting balance."),
    );
    expect(sql).toContain("order by u.id");
    expect(sql).toContain("on delete restrict");
    expect(sql).toContain("Counted opening movements cannot be changed or removed.");
    expect(sql).toContain(
      "Every active account must be included in the same starting balance.",
    );
    expect(sql).toContain("revoke all on table public.financial_account_opening_inclusions");
    expect(sql).toContain(
      "The opening balance cannot change once this account has transactions. Record an adjustment instead.",
    );
    expect(sql).toContain("app.allow_financial_account_initialization");
    expect(sql).toContain("set_config('app.allow_financial_account_initialization', 'on', true)");
    expect(sql).toContain("A reason for the starting balance is required.");
    expect(sql).toContain("A source reference for the starting balance is required.");
    expect(sql).toContain("An opening balance cannot be negative.");
    expect(sql).toContain("payment_paid_on_rejection(p_opening_balance_date)");
    expect(sql).toContain("The account belongs to a different school.");
    expect(sql).toContain("You are not authorized to set a starting balance.");
    expect(sql).toContain("has_finance_capability('FINANCE_SETUP_MANAGE')");
    expect(sql).toContain("Only an active account can receive a starting balance.");
    expect(sql).toMatch(
      /revoke all on function public\.initialize_school_opening_balances\(uuid, date, jsonb, text, text\)\s+from public, anon, authenticated, service_role;/i,
    );
    expect(sql).toContain("exception");
    expect(sql).not.toContain("v_voided_members");
    expect(sql).not.toContain("change the physical balance");
  });

  it("audits the count and does not post income, expense, transfer, or a copied amount", () => {
    expect(sql).toContain("'financial_account_opening_balance_initialized'");
    expect(sql).toContain("'opening_balance'");
    expect(sql).toContain("'opening_balance_date'");
    expect(sql).toContain("'source_reference'");
    expect(sql).toContain("'database_operator'");
    expect(sql).toContain("'account_code'");
    expect(initializer).not.toMatch(/insert\s+into\s+public\.finance_ledger_entries/i);
    expect(initializer).not.toMatch(/insert\s+into\s+public\.finance_expenses/i);
    expect(initializer).not.toMatch(/insert\s+into\s+public\.finance_transfers/i);
    expect(initializer).not.toMatch(/insert\s+into\s+public\.salary_payments/i);
    expect(sql).not.toContain("BFA-R-2026-");
    expect(initializer).not.toMatch(/update\s+public\.payments/i);
  });

  it("lets a date correction cross the count day because cash follows membership", () => {
    expect(sql).toContain("'opening_inclusion'");
    expect(sql).not.toContain(
      "This correction would move the receipt across the account opening-balance date and change the physical balance.",
    );
    const update = sql.match(
      /update public\.payments[\s\S]*?returning id into v_id;/,
    );
    expect(update?.[0]).toContain("set paid_on = p_corrected_paid_on");
    expect(update?.[0]).not.toMatch(/\bamount\b/i);
  });
});

describe("counted opening balance and unresolved dates", () => {
  const opening = {
    accountId: "mobile",
    openingBalance: 20000,
    openingBalanceDate: "2026-10-05",
  };

  it("keeps counted rows inside the opening and adds rows recorded afterwards", () => {
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [
          { entryDate: "2026-10-05", accountDelta: 100, insideOpeningBalance: true },
        ],
        receipts: [],
      }),
    ).toBe(20000);
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [{ entryDate: "2026-10-04", accountDelta: 100 }],
        receipts: [],
      }),
    ).toBe(20100);
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [],
        receipts: [
          {
            paidOn: "2026-10-04",
            amount: 50,
            accountId: "mobile",
            status: "completed",
          },
        ],
      }),
    ).toBe(20050);
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [{ entryDate: "2026-12-01", accountDelta: -25 }],
        receipts: [],
      }),
    ).toBe(19975);
  });

  it("does not add a year-92026 receipt that was already in the count", () => {
    const beforeCorrection = physicalAccountBalance({
      ...opening,
      ledger: [],
      receipts: [
        {
          paidOn: "92026-02-08",
          amount: 1200,
          accountId: "mobile",
          status: "completed",
          insideOpeningBalance: true,
        },
      ],
    });
    const afterCorrection = physicalAccountBalance({
      ...opening,
      ledger: [],
      receipts: [
        {
          paidOn: "2026-09-15",
          amount: 1200,
          accountId: "mobile",
          status: "completed",
          insideOpeningBalance: true,
        },
      ],
    });
    const wrongWay = physicalAccountBalance({
      ...opening,
      ledger: [],
      receipts: [
        {
          paidOn: "2026-12-01",
          amount: 1200,
          accountId: "mobile",
          status: "completed",
          insideOpeningBalance: true,
        },
      ],
    });
    expect(beforeCorrection).toBe(20000);
    expect(afterCorrection).toBe(20000);
    expect(wrongWay).toBe(20000);
  });

  it("does not remove counted cash when a member receipt is voided", () => {
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [],
        receipts: [
          {
            paidOn: "92026-02-08",
            amount: 1200,
            accountId: "mobile",
            status: "voided",
            insideOpeningBalance: true,
          },
        ],
      }),
    ).toBe(20000);
  });

  it("drops a receipt recorded after the count when that receipt is voided", () => {
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [],
        receipts: [
          {
            paidOn: "2026-10-04",
            amount: 1200,
            accountId: "mobile",
            status: "voided",
          },
        ],
      }),
    ).toBe(20000);
  });

  it("applies a reversal recorded after the count and ignores a reversal already inside it", () => {
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [
          { entryDate: "2026-09-01", accountDelta: -40, insideOpeningBalance: true },
          { entryDate: "2026-09-02", accountDelta: 40, insideOpeningBalance: true },
        ],
        receipts: [],
      }),
    ).toBe(20000);
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [
          { entryDate: "2026-09-01", accountDelta: -40, insideOpeningBalance: true },
          { entryDate: "2026-10-01", accountDelta: 40 },
        ],
        receipts: [],
      }),
    ).toBe(20040);
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [
          { entryDate: "2026-10-06", accountDelta: -40 },
          { entryDate: "2026-09-01", accountDelta: 40 },
        ],
        receipts: [],
      }),
    ).toBe(20000);
  });

  it("moves a backdated transfer between accounts and keeps the combined total", () => {
    const bank = physicalAccountBalance({
      accountId: "bank",
      openingBalance: 20000,
      openingBalanceDate: "2026-10-05",
      ledger: [{ entryDate: "2026-10-04", accountDelta: -2000 }],
      receipts: [],
    });
    const mobile = physicalAccountBalance({
      accountId: "mobile",
      openingBalance: 10000,
      openingBalanceDate: "2026-10-05",
      ledger: [{ entryDate: "2026-10-04", accountDelta: 2000 }],
      receipts: [],
    });
    expect(bank).toBe(18000);
    expect(mobile).toBe(12000);
    expect(bank + mobile).toBe(30000);
    expect(incomeEffect({ entryType: "transfer_out", direction: "out", amount: 2000 })).toBe(0);
    expect(expenseEffect({ entryType: "transfer_in", direction: "in", amount: 2000 })).toBe(0);
  });

  it("moves a transfer, an expense, and income only after the cutover day", () => {
    const transferOut = { entryType: "transfer_out" as const, direction: "out" as const, amount: 300 };
    const transferIn = { entryType: "transfer_in" as const, direction: "in" as const, amount: 300 };
    const expense = { entryType: "expense" as const, direction: "out" as const, amount: 40 };
    const income = { entryType: "income" as const, direction: "in" as const, amount: 75 };
    expect(incomeEffect(transferOut)).toBe(0);
    expect(expenseEffect(transferOut)).toBe(0);
    expect(accountDelta(transferOut)).toBe(-300);
    expect(accountDelta(transferIn)).toBe(300);
    expect(
      physicalAccountBalance({
        ...opening,
        ledger: [
          { entryDate: "2026-10-06", accountDelta: accountDelta(expense) },
          { entryDate: "2026-10-06", accountDelta: accountDelta(income) },
        ],
        receipts: [],
      }),
    ).toBe(20035);
  });

  it("reports a cash-count difference without posting it", () => {
    const system = physicalAccountBalance({
      ...opening,
      ledger: [{ entryDate: "2026-10-06", accountDelta: -25 }],
      receipts: [],
    });
    expect(system).toBe(19975);
    expect(reconciliationDifference(20000, system)).toBe(25);
    expect(reconciliationDifference(null, system)).toBeNull();
  });
});

describe("Money Held wording states", () => {
  it("asks for a verified count when activity already exists", () => {
    expect(
      moneyHeldAccountState({
        openingBalanceDate: null,
        assignedReceipts: 0,
        ledgerMovement: 0,
      }),
    ).toBe("not_initialized");
    expect(
      moneyHeldAccountState({
        openingBalanceDate: null,
        assignedReceipts: 1050,
        ledgerMovement: 0,
      }),
    ).toBe("verified_setup_required");
    expect(
      moneyHeldAccountState({
        openingBalanceDate: "2026-10-05",
        assignedReceipts: 0,
        ledgerMovement: 0,
      }),
    ).toBe("initialized");
    expect(formatCutoverDate("2026-10-05")).toMatch(/2026/);
    expect(formatCutoverDate("2026-10-05")).toMatch(/Oct/);
  });
});
