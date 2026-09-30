import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { paymentPaidOnError, schoolToday } from "@/lib/dates";
import { physicalAccountBalance } from "@/features/finance/ledger-math";

const TODAY = "2026-09-30";
const guardSql = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260930180000_payment_paid_on_not_future.sql",
  ),
  "utf8",
);
const correctionSql = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260930180100_payment_paid_on_correction.sql",
  ),
  "utf8",
);

function withoutComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

describe("new payment dates", () => {
  it("accepts today and yesterday", () => {
    expect(paymentPaidOnError("2026-09-30", TODAY)).toBeNull();
    expect(paymentPaidOnError("2026-09-29", TODAY)).toBeNull();
  });

  it("rejects tomorrow and the known future production dates", () => {
    expect(paymentPaidOnError("2026-10-01", TODAY)).toBe(
      "The payment date cannot be after today.",
    );
    expect(paymentPaidOnError("2026-11-09", TODAY)).toBe(
      "The payment date cannot be after today.",
    );
    expect(paymentPaidOnError("2026-12-07", TODAY)).toBe(
      "The payment date cannot be after today.",
    );
    expect(paymentPaidOnError("2026-12-09", TODAY)).toBe(
      "The payment date cannot be after today.",
    );
  });

  it("rejects years that are not four digits and dates that are not real", () => {
    expect(paymentPaidOnError("20266-04-09", TODAY)).toBe(
      "Enter a valid payment date.",
    );
    expect(paymentPaidOnError("92026-02-08", TODAY)).toBe(
      "Enter a valid payment date.",
    );
    expect(paymentPaidOnError("0100-01-01", TODAY)).toBe(
      "Enter a valid payment date.",
    );
    expect(paymentPaidOnError("2026-02-31", TODAY)).toBe(
      "Enter a valid payment date.",
    );
    expect(paymentPaidOnError("09/30/2026", TODAY)).toBe(
      "Enter a valid payment date.",
    );
    expect(paymentPaidOnError("", TODAY)).toBe("Enter a valid payment date.");
  });
});

describe("database date guard does not brick historical rows", () => {
  const sql = withoutComments(guardSql);

  it("runs only before insert", () => {
    expect(sql).toMatch(/before insert on public\.payments/i);
    expect(sql).not.toMatch(/before update on public\.payments/i);
    expect(sql).not.toMatch(/update\s+public\.payments/i);
  });

  it("rejects a future day and a year outside four digits", () => {
    expect(sql).toContain(
      "p_paid_on > (now() at time zone 'Africa/Lusaka')::date",
    );
    expect(sql).toContain("v_year < 1000 or v_year > 9999");
  });

  it("does not name any of the 14 production receipts", () => {
    expect(guardSql).not.toContain("BFA-R-2026-");
    expect(correctionSql).not.toContain("BFA-R-2026-");
  });
});

describe("paid_on correction stays narrow", () => {
  const sql = withoutComments(correctionSql);

  it("keeps void from rechecking a historical paid_on", () => {
    expect(sql).toContain("new.paid_on = old.paid_on");
    expect(sql).toContain("app.allow_payment_void");
    expect(sql).toContain(
      "Payments are immutable. Use public.void_payment to reverse a completed payment.",
    );
  });

  it("changes only paid_on and records each correction", () => {
    const update = sql.match(/update public\.payments[\s\S]*?returning id into v_id;/);
    expect(update?.[0]).toBeTruthy();
    expect(update?.[0]).toContain("set paid_on = p_corrected_paid_on");
    expect(update?.[0]).not.toMatch(/\bamount\b/i);
    expect(update?.[0]).not.toMatch(/student_id/i);
    expect(update?.[0]).not.toMatch(/receipt_number/i);
    expect(update?.[0]).not.toMatch(/financial_account_id/i);
    expect(update?.[0]).not.toMatch(/\bstatus\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.payments/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.payment_allocations/i);
    expect(sql).toContain("'payment_date_corrected'");
    expect(sql).toContain("'old_paid_on'");
    expect(sql).toContain("'new_paid_on'");
    expect(sql).toContain("'source_reference'");
    expect(sql.match(/'payment_date_corrected'/g)?.length).toBeGreaterThan(1);
  });

  it("rejects a missing reason and an unauthorized portal role", () => {
    expect(sql).toContain("A correction reason is required.");
    expect(sql).toContain("A source reference for the corrected date is required.");
    expect(sql).toContain("has_finance_capability('FINANCE_SETUP_MANAGE')");
    expect(sql).toContain("The payment belongs to a different school.");
    expect(sql).toMatch(
      /revoke all on function public\.correct_payment_paid_on\(uuid, date, text, text\)\s+from public, anon, authenticated, service_role;/i,
    );
  });

  it("rejects a same-date no-op, a voided payment, and a cutover crossing", () => {
    expect(sql).toContain("The payment is already dated on that day.");
    expect(sql).toContain("Only a completed payment can have its date corrected.");
    expect(sql).toContain(
      "This correction would move the receipt across the account opening-balance date and change the physical balance.",
    );
    expect(sql).toContain("for update");
    const paymentLock = sql.indexOf("for update");
    const sameDate = sql.indexOf("The payment is already dated on that day.");
    const update = sql.indexOf("update public.payments");
    expect(paymentLock).toBeGreaterThan(-1);
    expect(paymentLock).toBeLessThan(sameDate);
    expect(sameDate).toBeLessThan(update);
  });

  it("records a database operator instead of a portal user when auth.uid() is null", () => {
    expect(sql).toContain("'database_operator'");
    expect(sql).toContain("v_actor uuid := auth.uid()");
    expect(sql).not.toMatch(/insert\s+into\s+public\.finance_event_audits/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.finance_event_audits/i);
    expect(sql).not.toMatch(/update\s+public\.finance_event_audits/i);
  });

  it("uses a transaction-local escape and validates the new date only", () => {
    expect(sql).toContain(
      "set_config('app.allow_payment_paid_on_correction', 'on', true)",
    );
    expect(sql).toContain("payment_paid_on_rejection(new.paid_on)");
    expect(sql).not.toContain("payment_paid_on_rejection(old.paid_on)");
  });
});

describe("correcting paid_on moves cutover placement and not the receipt amount", () => {
  const receipt = {
    amount: 600,
    accountId: "mobile",
    status: "completed" as const,
  };

  it("counts a future paid_on after cutover and drops it once the date is on or before cutover", () => {
    const stored = physicalAccountBalance({
      accountId: "mobile",
      openingBalance: 20000,
      openingBalanceDate: "2026-09-30",
      ledger: [],
      receipts: [{ ...receipt, paidOn: "2026-12-09" }],
    });
    const corrected = physicalAccountBalance({
      accountId: "mobile",
      openingBalance: 20000,
      openingBalanceDate: "2026-09-30",
      ledger: [],
      receipts: [{ ...receipt, paidOn: "2026-09-15" }],
    });
    expect(stored).toBe(20600);
    expect(corrected).toBe(20000);
    expect(receipt.amount).toBe(600);
  });

  it("keeps the physical total when both dates stay after the cutover", () => {
    const later = physicalAccountBalance({
      accountId: "mobile",
      openingBalance: 20000,
      openingBalanceDate: "2026-09-30",
      ledger: [],
      receipts: [{ ...receipt, paidOn: "2026-12-09" }],
    });
    const stillAfter = physicalAccountBalance({
      accountId: "mobile",
      openingBalance: 20000,
      openingBalanceDate: "2026-09-30",
      ledger: [],
      receipts: [{ ...receipt, paidOn: "2026-10-02" }],
    });
    expect(later).toBe(20600);
    expect(stillAfter).toBe(20600);
  });
});

describe("Lusaka today matches the calendar day, not UTC", () => {
  it("rolls to 1 Oct while UTC is still 30 Sep", () => {
    const justBeforeMidnight = new Date("2026-09-30T21:59:00.000Z");
    const atMidnight = new Date("2026-09-30T22:00:00.000Z");
    expect(schoolToday("Africa/Lusaka", justBeforeMidnight)).toBe("2026-09-30");
    expect(schoolToday("Africa/Lusaka", atMidnight)).toBe("2026-10-01");
    expect(schoolToday("UTC", atMidnight)).toBe("2026-09-30");
    expect(paymentPaidOnError("2026-10-01", schoolToday("Africa/Lusaka", atMidnight))).toBeNull();
    expect(paymentPaidOnError("2026-10-01", schoolToday("UTC", atMidnight))).toBe(
      "The payment date cannot be after today.",
    );
  });
});
