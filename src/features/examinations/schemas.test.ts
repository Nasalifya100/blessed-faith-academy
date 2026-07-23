import { describe, expect, it } from "vitest";

import {
  canManageExamSetup,
  canOpenExaminations,
  hasExamCapability,
} from "@/features/examinations/permissions";
import {
  EXAM_LIFECYCLE_STATUSES,
  EXAM_PERIOD_STATUS_LABELS,
  examPeriodSchema,
  examScheduleSchema,
  examSchema,
  isValidExamReference,
  parseConflictWarnings,
  transitionExamStatusSchema,
} from "@/features/examinations/schemas";

describe("exam permissions", () => {
  it("allows administrators to manage exam setup", () => {
    expect(hasExamCapability("administrator", "EXAM_PERIODS_MANAGE")).toBe(
      true,
    );
    expect(canManageExamSetup("administrator")).toBe(true);
  });

  it("allows headteachers to manage and teachers to view only", () => {
    expect(hasExamCapability("headteacher", "EXAMS_MANAGE")).toBe(true);
    expect(hasExamCapability("teacher", "EXAM_VIEW")).toBe(true);
    expect(hasExamCapability("teacher", "EXAMS_MANAGE")).toBe(false);
    expect(canOpenExaminations("teacher")).toBe(true);
    expect(canManageExamSetup("teacher")).toBe(false);
  });
});

describe("exam references", () => {
  it("accepts the EX-YEAR-Tn-#### format", () => {
    expect(isValidExamReference("EX-2027-T1-0001")).toBe(true);
    expect(isValidExamReference("EX-2027-TY-0042")).toBe(true);
    expect(isValidExamReference("EX-2027-T5-0001")).toBe(false);
    expect(isValidExamReference("")).toBe(false);
  });
});

describe("exam lifecycle schema", () => {
  it("defaults new exams conceptually to Draft in status list", () => {
    expect(EXAM_LIFECYCLE_STATUSES[0]).toBe("DRAFT");
  });

  it("validates status transition payloads and optional reason", () => {
    const ok = transitionExamStatusSchema.safeParse({
      exam_id: "11111111-1111-4111-8111-111111111111",
      new_status: "SCHEDULED",
    });
    expect(ok.success).toBe(true);

    const withReason = transitionExamStatusSchema.safeParse({
      exam_id: "11111111-1111-4111-8111-111111111111",
      new_status: "SCHEDULED",
      reason: "Returned for date correction",
    });
    expect(withReason.success).toBe(true);

    const bad = transitionExamStatusSchema.safeParse({
      exam_id: "not-a-uuid",
      new_status: "READY",
    });
    expect(bad.success).toBe(false);
  });

  it("maps period CLOSED to Completed for staff labels", () => {
    expect(EXAM_PERIOD_STATUS_LABELS.CLOSED).toBe("Completed");
  });
});

describe("exam schemas", () => {
  it("requires an exam period name and valid dates", () => {
    expect(
      examPeriodSchema.safeParse({
        academic_year_id: "11111111-1111-4111-8111-111111111111",
        name: "",
      }).success,
    ).toBe(false);

    expect(
      examPeriodSchema.safeParse({
        academic_year_id: "11111111-1111-4111-8111-111111111111",
        name: "Mid-Term Tests",
        opens_on: "2026-08-20",
        closes_on: "2026-08-10",
      }).success,
    ).toBe(false);

    expect(
      examPeriodSchema.safeParse({
        academic_year_id: "11111111-1111-4111-8111-111111111111",
        name: "Mid-Term Tests",
        opens_on: "2026-08-10",
        closes_on: "2026-08-20",
      }).success,
    ).toBe(true);
  });

  it("requires positive max marks for exams", () => {
    expect(
      examSchema.safeParse({
        exam_period_id: "11111111-1111-4111-8111-111111111111",
        subject_id: "22222222-2222-4222-8222-222222222222",
        grade_level_id: "33333333-3333-4333-8333-333333333333",
        assessment_type_id: "44444444-4444-4444-8444-444444444444",
        max_marks: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects end time before start time", () => {
    const bad = examScheduleSchema.safeParse({
      exam_id: "11111111-1111-4111-8111-111111111111",
      exam_date: "2026-08-12",
      start_time: "11:00",
      end_time: "09:00",
    });
    expect(bad.success).toBe(false);
  });

  it("parses conflict warnings with fix text", () => {
    const warnings = parseConflictWarnings([
      {
        code: "ROOM_DOUBLE_BOOKED",
        message: "Room is already used",
        fix: "Choose a different room",
      },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fix).toContain("different room");
  });
});
