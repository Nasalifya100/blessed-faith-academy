import { describe, expect, it } from "vitest";

import {
  allocateAmountOldestFirst,
  availableCreditFromTotals,
  netAccountPosition,
  previewCreditApplication,
  previewPaymentApplication,
  sortChargesOldestFirst,
} from "@/features/fees/payment-preview";
import {
  applyAvailableCreditSchema,
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/features/fees/schemas";

const UUID_A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const UUID_B = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const UUID_C = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

describe("previewPaymentApplication", () => {
  it("handles payment less than outstanding", () => {
    const preview = previewPaymentApplication({
      amountReceived: 500,
      outstandingBalance: 1500,
    });
    expect(preview.amountApplied).toBe(500);
    expect(preview.creditCreated).toBe(0);
    expect(preview.outstandingAfter).toBe(1000);
    expect(preview.createsCredit).toBe(false);
  });

  it("handles payment equal to outstanding", () => {
    const preview = previewPaymentApplication({
      amountReceived: 1500,
      outstandingBalance: 1500,
    });
    expect(preview.amountApplied).toBe(1500);
    expect(preview.creditCreated).toBe(0);
    expect(preview.outstandingAfter).toBe(0);
  });

  it("handles overpayment and creates credit", () => {
    const preview = previewPaymentApplication({
      amountReceived: 2500,
      outstandingBalance: 1500,
    });
    expect(preview.amountReceived).toBe(2500);
    expect(preview.amountApplied).toBe(1500);
    expect(preview.creditCreated).toBe(1000);
    expect(preview.outstandingAfter).toBe(0);
    expect(preview.createsCredit).toBe(true);
  });

  it("handles advance payment when outstanding is zero", () => {
    const preview = previewPaymentApplication({
      amountReceived: 1000,
      outstandingBalance: 0,
    });
    expect(preview.amountApplied).toBe(0);
    expect(preview.creditCreated).toBe(1000);
    expect(preview.isAdvanceOnly).toBe(true);
  });

  it("keeps decimal precision exact via ngwee", () => {
    const preview = previewPaymentApplication({
      amountReceived: 10.1,
      outstandingBalance: 0.2,
    });
    expect(preview.amountApplied).toBe(0.2);
    expect(preview.creditCreated).toBe(9.9);
  });
});

describe("allocateAmountOldestFirst", () => {
  it("allocates across multiple charges without exceeding amounts", () => {
    const result = allocateAmountOldestFirst(1000, [
      { id: "c1", remaining: 400 },
      { id: "c2", remaining: 400 },
      { id: "c3", remaining: 400 },
    ]);
    expect(result.allocations).toEqual([
      { chargeId: "c1", amount: 400 },
      { chargeId: "c2", amount: 400 },
      { chargeId: "c3", amount: 200 },
    ]);
    expect(result.unallocated).toBe(0);
  });

  it("leaves unallocated credit when payment exceeds charges", () => {
    const result = allocateAmountOldestFirst(2500, [
      { id: "c1", remaining: 1500 },
    ]);
    expect(result.allocations).toEqual([{ chargeId: "c1", amount: 1500 }]);
    expect(result.unallocated).toBe(1000);
  });

  it("never exceeds payment amount", () => {
    const result = allocateAmountOldestFirst(100, [
      { id: "c1", remaining: 1000 },
    ]);
    expect(result.allocations[0]?.amount).toBe(100);
    expect(result.unallocated).toBe(0);
  });
});

describe("sortChargesOldestFirst", () => {
  it("orders by year, term, created_at, then id", () => {
    const sorted = sortChargesOldestFirst([
      {
        id: "b",
        yearStart: "2026-01-01",
        termStart: "2026-05-01",
        termNumber: 2,
        createdAt: "2026-05-02T00:00:00Z",
      },
      {
        id: "a",
        yearStart: "2025-01-01",
        termStart: "2025-01-01",
        termNumber: 1,
        createdAt: "2025-01-02T00:00:00Z",
      },
      {
        id: "c",
        yearStart: "2026-01-01",
        termStart: "2026-01-01",
        termNumber: 1,
        createdAt: "2026-01-02T00:00:00Z",
      },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "c", "b"]);
  });

  it("uses charge id as stable tie-breaker", () => {
    const sorted = sortChargesOldestFirst([
      {
        id: "z",
        yearStart: "2026-01-01",
        termStart: null,
        termNumber: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "a",
        yearStart: "2026-01-01",
        termStart: null,
        termNumber: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "z"]);
  });
});

describe("available credit and net position", () => {
  it("derives credit from payments minus allocations", () => {
    expect(availableCreditFromTotals(2500, 1500)).toBe(1000);
    expect(availableCreditFromTotals(1000, 1500)).toBe(0);
  });

  it("computes net account position", () => {
    expect(netAccountPosition(0, 1000)).toBe(-1000);
    expect(netAccountPosition(500, 200)).toBe(300);
  });
});

describe("previewCreditApplication", () => {
  it("applies oldest credit preview without creating a payment", () => {
    const preview = previewCreditApplication({
      availableCredit: 1000,
      outstandingBalance: 2000,
    });
    expect(preview.creditToApply).toBe(1000);
    expect(preview.remainingOutstanding).toBe(1000);
    expect(preview.remainingCredit).toBe(0);
  });
});

describe("payment schemas after overpayment change", () => {
  it("allows amount greater than prior outstanding concept", () => {
    const parsed = recordPaymentSchema.safeParse({
      studentId: UUID_A,
      amount: 2500,
      method: "mobile_money",
      idempotencyKey: UUID_B,
      paid_on: "2026-07-15",
      confirmCredit: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("allows advance payment when outstanding is zero", () => {
    const parsed = recordPaymentSchema.safeParse({
      studentId: UUID_A,
      amount: 1000,
      method: "bank_transfer",
      idempotencyKey: UUID_C,
      paid_on: "2026-07-15",
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires void reason", () => {
    expect(
      voidPaymentSchema.safeParse({
        paymentId: UUID_A,
        studentId: UUID_B,
        reason: "ab",
      }).success,
    ).toBe(false);
  });

  it("requires explicit confirm for apply credit", () => {
    expect(
      applyAvailableCreditSchema.safeParse({
        studentId: UUID_A,
        confirm: false,
      }).success,
    ).toBe(false);
    expect(
      applyAvailableCreditSchema.safeParse({
        studentId: UUID_A,
        confirm: true,
      }).success,
    ).toBe(true);
  });
});
