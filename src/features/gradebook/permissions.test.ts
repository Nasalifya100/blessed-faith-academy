import { describe, expect, it } from "vitest";

import {
  canEnterGradebookMarks,
  canLockGradebook,
  canOpenGradebook,
  canReopenGradebook,
  hasGradebookCapability,
} from "@/features/gradebook/permissions";
import {
  GRADEBOOK_STATUSES,
  gradebookResultRowSchema,
  marksWithinMaximum,
  reopenGradebookSchema,
  saveGradebookDraftSchema,
  submitGradebookSchema,
} from "@/features/gradebook/schemas";

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const STUDENT_B = "22222222-2222-4222-8222-222222222222";
const GRADEBOOK_ID = "33333333-3333-4333-8333-333333333333";

/** Documented Stage 1 transitions (server-enforced). */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  REOPENED: ["SUBMITTED"],
  SUBMITTED: ["REOPENED", "LOCKED"],
  LOCKED: [],
};

describe("gradebook permissions (least privilege)", () => {
  it("allows teachers to enter but not reopen, lock, or view-all", () => {
    expect(hasGradebookCapability("teacher", "GRADEBOOK_ENTER")).toBe(true);
    expect(canEnterGradebookMarks("teacher")).toBe(true);
    expect(canOpenGradebook("teacher")).toBe(true);
    expect(canReopenGradebook("teacher")).toBe(false);
    expect(canLockGradebook("teacher")).toBe(false);
    expect(hasGradebookCapability("teacher", "GRADEBOOK_VIEW_ALL")).toBe(false);
  });

  it("denies secretary and bursar default marks visibility", () => {
    expect(hasGradebookCapability("secretary", "GRADEBOOK_VIEW_ALL")).toBe(
      false,
    );
    expect(hasGradebookCapability("bursar", "GRADEBOOK_VIEW_ALL")).toBe(false);
    expect(canEnterGradebookMarks("secretary")).toBe(false);
    expect(canOpenGradebook("secretary")).toBe(false);
    expect(canReopenGradebook("secretary")).toBe(false);
  });

  it("allows headteacher and administrator elevated actions", () => {
    expect(canEnterGradebookMarks("headteacher")).toBe(true);
    expect(hasGradebookCapability("headteacher", "GRADEBOOK_VIEW_ALL")).toBe(
      true,
    );
    expect(canReopenGradebook("headteacher")).toBe(true);
    expect(canLockGradebook("administrator")).toBe(true);
    expect(hasGradebookCapability("administrator", "GRADEBOOK_CORRECT")).toBe(
      true,
    );
  });
});

describe("gradebook state machine (documented)", () => {
  it("lists Stage 1 statuses", () => {
    expect(GRADEBOOK_STATUSES).toEqual([
      "DRAFT",
      "SUBMITTED",
      "REOPENED",
      "LOCKED",
    ]);
  });

  it("does not allow LOCKED outgoing transitions in Stage 1", () => {
    expect(ALLOWED_TRANSITIONS.LOCKED).toEqual([]);
  });

  it("allows SUBMITTED to REOPENED and LOCKED only", () => {
    expect(ALLOWED_TRANSITIONS.SUBMITTED).toEqual(["REOPENED", "LOCKED"]);
  });

  it("rejects DRAFT reopen/lock and REOPENED lock without resubmit", () => {
    expect(ALLOWED_TRANSITIONS.DRAFT).not.toContain("REOPENED");
    expect(ALLOWED_TRANSITIONS.DRAFT).not.toContain("LOCKED");
    expect(ALLOWED_TRANSITIONS.REOPENED).toEqual(["SUBMITTED"]);
  });
});

describe("gradebook uniqueness policy (documented)", () => {
  it("documents gradebook-scoped uniqueness, not global exam+student", () => {
    // Server enforces SUBMITTED/LOCKED uniqueness across class gradebooks in RPCs.
    // Client schemas only scope rows within a single save payload.
    const parsed = saveGradebookDraftSchema.safeParse({
      gradebook_id: GRADEBOOK_ID,
      expected_revision: 1,
      rows: [
        { student_id: STUDENT_A, entry_status: "SCORED", marks_obtained: 10 },
        { student_id: STUDENT_B, entry_status: "SCORED", marks_obtained: 10 },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("gradebook draft schemas", () => {
  it("documents partial-upsert semantics via min(1) rows without requiring full roster", () => {
    const parsed = saveGradebookDraftSchema.safeParse({
      gradebook_id: GRADEBOOK_ID,
      expected_revision: 1,
      rows: [
        { student_id: STUDENT_A, entry_status: "SCORED", marks_obtained: 10 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid scored row", () => {
    const parsed = gradebookResultRowSchema.safeParse({
      student_id: STUDENT_A,
      entry_status: "SCORED",
      marks_obtained: 42,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects negative marks and non-finite numbers", () => {
    expect(
      gradebookResultRowSchema.safeParse({
        student_id: STUDENT_A,
        entry_status: "SCORED",
        marks_obtained: -1,
      }).success,
    ).toBe(false);
    expect(
      gradebookResultRowSchema.safeParse({
        student_id: STUDENT_A,
        entry_status: "SCORED",
        marks_obtained: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
    expect(
      gradebookResultRowSchema.safeParse({
        student_id: STUDENT_A,
        entry_status: "SCORED",
        marks_obtained: Number.NaN,
      }).success,
    ).toBe(false);
  });

  it("rejects scored without mark and absent with mark", () => {
    expect(
      gradebookResultRowSchema.safeParse({
        student_id: STUDENT_A,
        entry_status: "SCORED",
        marks_obtained: null,
      }).success,
    ).toBe(false);
    expect(
      gradebookResultRowSchema.safeParse({
        student_id: STUDENT_A,
        entry_status: "ABSENT",
        marks_obtained: 10,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate students in one payload", () => {
    const parsed = saveGradebookDraftSchema.safeParse({
      gradebook_id: GRADEBOOK_ID,
      expected_revision: 1,
      rows: [
        { student_id: STUDENT_A, entry_status: "SCORED", marks_obtained: 10 },
        { student_id: STUDENT_A, entry_status: "ABSENT" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid multi-row batch", () => {
    const parsed = saveGradebookDraftSchema.safeParse({
      gradebook_id: GRADEBOOK_ID,
      expected_revision: 2,
      rows: [
        { student_id: STUDENT_A, entry_status: "SCORED", marks_obtained: 10 },
        { student_id: STUDENT_B, entry_status: "EXEMPT" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires reopen reason of substance and expected_revision", () => {
    expect(
      reopenGradebookSchema.safeParse({
        gradebook_id: GRADEBOOK_ID,
        expected_revision: 1,
        reason: "  ",
      }).success,
    ).toBe(false);
    expect(
      reopenGradebookSchema.safeParse({
        gradebook_id: GRADEBOOK_ID,
        reason: "Moderation correction required",
      }).success,
    ).toBe(false);
    expect(
      reopenGradebookSchema.safeParse({
        gradebook_id: GRADEBOOK_ID,
        expected_revision: 2,
        reason: "Moderation correction required",
      }).success,
    ).toBe(true);
  });

  it("requires positive expected_revision for submit", () => {
    expect(
      submitGradebookSchema.safeParse({
        gradebook_id: GRADEBOOK_ID,
        expected_revision: 0,
      }).success,
    ).toBe(false);
  });

  it("checks marks against exam maximum on the client helper", () => {
    expect(marksWithinMaximum(50, 50)).toBe(true);
    expect(marksWithinMaximum(50.01, 50)).toBe(false);
    expect(marksWithinMaximum(null, 50)).toBe(true);
  });
});
