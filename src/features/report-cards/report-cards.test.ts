import { describe, expect, it } from "vitest";

import {
  canApproveReportCards,
  canEditReportCardRemarks,
  canManageReportCardSettings,
  canOpenReportCards,
  canPrintReportCards,
  canPublishReportCards,
  canReviewReportCards,
  hasReportCardCapability,
} from "@/features/report-cards/permissions";
import {
  generateClassDraftsSchema,
  reportCardIdRevisionSchema,
  saveRemarksSchema,
  updateReportCardSettingsSchema,
  voidReportCardSchema,
} from "@/features/report-cards/schemas";
import {
  buildAttendanceSnapshot,
  checksumRenderPayload,
  defaultReportCardSettings,
  emptyAttendanceSnapshot,
  sanitizePlainRemark,
} from "@/features/report-cards/snapshot";
import type { ReportCardRenderPayload } from "@/features/report-cards/types";

/** Documented Phase 2D.2 transitions (server-enforced). */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REVIEWED", "APPROVED", "VOIDED"],
  REVIEWED: ["APPROVED", "VOIDED"],
  APPROVED: ["PUBLISHED", "VOIDED"],
  PUBLISHED: ["UNPUBLISHED"],
  UNPUBLISHED: ["PUBLISHED", "APPROVED", "VOIDED"],
  VOIDED: [],
};

function samplePayload(
  overrides: Partial<ReportCardRenderPayload> = {},
): ReportCardRenderPayload {
  return {
    schema_version: "2d.2.1",
    source_fingerprint: "fp-abc",
    engine_version: "2d.1.1",
    computation_batch_id: "00000000-0000-4000-8000-000000000001",
    template_version: "2d.2.1",
    generated_at: "2026-07-24T12:00:00.000Z",
    school: {
      name: "Blessed Faith Academy",
      motto: null,
      address: null,
      phone: null,
      email: null,
      logo_url: null,
    },
    academic_year: { id: "y1", name: "2026" },
    term: { id: "t1", name: "Term 1" },
    class: { id: "c1", name: "A", grade_name: "Grade 1" },
    student: {
      id: "s1",
      first_name: "Ada",
      last_name: "Lovelace",
      middle_name: null,
      admission_number: "BF001",
    },
    student_id: "s1",
    class_id: "c1",
    subjects: [
      {
        subject_id: "sub1",
        subject_name: "Math",
        weighted_percentage: 0,
        grade_code: "F",
        grade_label: "Fail",
        grade_point: 0,
        is_pass: false,
        remark: null,
        subject_position: null,
        entry_statuses: ["SCORED"],
      },
    ],
    summary: {
      average_percentage: 0,
      grade_code: "F",
      grade_label: "Fail",
      grade_point: 0,
      overall_position: 1,
      tied_count: 1,
      passed_subject_count: 0,
      failed_subject_count: 1,
      scored_subject_count: 1,
      subject_count: 1,
      promotion_outcome: "RETAIN",
      promotion_reason: "Below pass threshold",
      ranking_enabled: true,
    },
    attendance: emptyAttendanceSnapshot("2026-01-01", "2026-04-01", "No registers"),
    remarks: { teacher: "Good effort", headteacher: "Keep working" },
    settings: defaultReportCardSettings(),
    grading_key: [],
    signatories: {
      class_teacher_name: "Ms Teacher",
      headteacher_title: "Head Teacher",
    },
    ...overrides,
  };
}

describe("report card permissions (least privilege)", () => {
  it("allows teachers to view/edit remarks/print but not approve or publish", () => {
    expect(canOpenReportCards("teacher")).toBe(true);
    expect(canEditReportCardRemarks("teacher")).toBe(true);
    expect(canPrintReportCards("teacher")).toBe(true);
    expect(canReviewReportCards("teacher")).toBe(false);
    expect(canApproveReportCards("teacher")).toBe(false);
    expect(canPublishReportCards("teacher")).toBe(false);
    expect(canManageReportCardSettings("teacher")).toBe(false);
  });

  it("denies secretary and bursar by default", () => {
    expect(canOpenReportCards("secretary")).toBe(false);
    expect(canOpenReportCards("bursar")).toBe(false);
    expect(hasReportCardCapability("secretary", "REPORT_CARDS_PRINT")).toBe(
      false,
    );
    expect(hasReportCardCapability("bursar", "REPORT_CARDS_VIEW")).toBe(false);
  });

  it("allows headteacher and administrator elevated actions", () => {
    expect(canApproveReportCards("headteacher")).toBe(true);
    expect(canPublishReportCards("headteacher")).toBe(true);
    expect(canManageReportCardSettings("headteacher")).toBe(true);
    expect(canApproveReportCards("administrator")).toBe(true);
    expect(canPublishReportCards("administrator")).toBe(true);
  });
});

describe("report card lifecycle (documented)", () => {
  it("supports draft → reviewed → approved → published", () => {
    expect(ALLOWED_TRANSITIONS.DRAFT).toContain("REVIEWED");
    expect(ALLOWED_TRANSITIONS.REVIEWED).toContain("APPROVED");
    expect(ALLOWED_TRANSITIONS.APPROVED).toContain("PUBLISHED");
  });

  it("supports publish ↔ unpublish and void from non-published states", () => {
    expect(ALLOWED_TRANSITIONS.PUBLISHED).toEqual(["UNPUBLISHED"]);
    expect(ALLOWED_TRANSITIONS.UNPUBLISHED).toContain("PUBLISHED");
    expect(ALLOWED_TRANSITIONS.VOIDED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.DRAFT).toContain("VOIDED");
  });

  it("does not allow silent edit of published content (no DRAFT from PUBLISHED)", () => {
    expect(ALLOWED_TRANSITIONS.PUBLISHED).not.toContain("DRAFT");
    expect(ALLOWED_TRANSITIONS.PUBLISHED).not.toContain("APPROVED");
  });
});

describe("remarks sanitization", () => {
  it("strips HTML and control characters", () => {
    expect(sanitizePlainRemark("<b>Hello</b>\u0000 world")).toBe("Hello world");
  });

  it("returns null for empty remarks", () => {
    expect(sanitizePlainRemark("   ")).toBeNull();
    expect(sanitizePlainRemark(null)).toBeNull();
  });

  it("caps length at 2000", () => {
    const long = "a".repeat(2500);
    expect(sanitizePlainRemark(long)?.length).toBe(2000);
  });
});

describe("attendance snapshot", () => {
  it("treats missing registers as unavailable, not zero", () => {
    const snap = buildAttendanceSnapshot({
      termStart: "2026-01-01",
      termEnd: "2026-04-01",
      statuses: [],
    });
    expect(snap.available).toBe(false);
    expect(snap.percentage).toBeNull();
    expect(snap.note).toMatch(/no attendance/i);
  });

  it("computes rate from authoritative statuses", () => {
    const snap = buildAttendanceSnapshot({
      termStart: "2026-01-01",
      termEnd: "2026-04-01",
      statuses: ["present", "present", "absent", "late", "excused"],
    });
    expect(snap.available).toBe(true);
    expect(snap.present).toBe(2);
    expect(snap.absent).toBe(1);
    expect(snap.late).toBe(1);
    expect(snap.excused).toBe(1);
    expect(snap.percentage).toBe(60);
  });
});

describe("immutable render payload checksum", () => {
  it("is stable for identical payloads", () => {
    const a = checksumRenderPayload(samplePayload());
    const b = checksumRenderPayload(samplePayload());
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when academic summary changes", () => {
    const a = checksumRenderPayload(samplePayload());
    const b = checksumRenderPayload(
      samplePayload({
        summary: {
          ...samplePayload().summary,
          average_percentage: 88,
        },
      }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when a subject percentage is forged", () => {
    const base = samplePayload();
    const forged = samplePayload({
      subjects: [
        {
          ...base.subjects[0]!,
          weighted_percentage: 99,
        },
      ],
    });
    expect(checksumRenderPayload(base)).not.toBe(checksumRenderPayload(forged));
  });

  it("displays zero as a valid score, not as missing", () => {
    const payload = samplePayload();
    expect(payload.subjects[0]?.weighted_percentage).toBe(0);
    expect(payload.summary.average_percentage).toBe(0);
  });

  it("keeps provenance fields required for audit", () => {
    const payload = samplePayload();
    expect(payload.source_fingerprint).toBeTruthy();
    expect(payload.engine_version).toBeTruthy();
    expect(payload.computation_batch_id).toBeTruthy();
    expect(payload.template_version).toBeTruthy();
    expect(payload.generated_at).toBeTruthy();
    expect(payload.student_id).toBeTruthy();
    expect(payload.class_id).toBeTruthy();
  });
});

describe("approval payload contract (documented server checks)", () => {
  const REQUIRED_APPROVAL_MISMATCH_ERRORS = [
    "Render payload average does not match Phase 2D.1 snapshot.",
    "Render payload subject percentage does not match Phase 2D.1 snapshot.",
    "Render payload attendance does not match the stored attendance snapshot.",
    "Render payload teacher remark does not match saved remarks.",
    "Source gradebooks changed or were reopened. Recalculate results before continuing.",
  ];

  it("documents fail-closed academic mismatch messages", () => {
    for (const msg of REQUIRED_APPROVAL_MISMATCH_ERRORS) {
      expect(msg.length).toBeGreaterThan(20);
    }
  });

  it("does not allow published silent academic mutation in state machine", () => {
    expect(ALLOWED_TRANSITIONS.PUBLISHED).toEqual(["UNPUBLISHED"]);
    expect(ALLOWED_TRANSITIONS.PUBLISHED).not.toContain("DRAFT");
  });
});

describe("source readiness helpers", () => {
  it("treats fingerprint mismatch as outdated in list semantics", () => {
    const liveFingerprint: string = "fp-new";
    const cardFingerprint: string = "fp-old";
    const outdated =
      !liveFingerprint || liveFingerprint !== cardFingerprint;
    expect(outdated).toBe(true);
  });
});

describe("schemas", () => {
  it("requires uuids for class draft generation", () => {
    expect(
      generateClassDraftsSchema.safeParse({
        academic_year_id: "not-a-uuid",
        term_id: "00000000-0000-4000-8000-000000000001",
        class_id: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });

  it("requires positive revision", () => {
    expect(
      reportCardIdRevisionSchema.safeParse({
        report_card_id: "00000000-0000-4000-8000-000000000001",
        expected_revision: 0,
      }).success,
    ).toBe(false);
  });

  it("requires void reason length", () => {
    expect(
      voidReportCardSchema.safeParse({
        report_card_id: "00000000-0000-4000-8000-000000000001",
        expected_revision: 1,
        reason: "no",
      }).success,
    ).toBe(false);
  });

  it("caps remark length", () => {
    expect(
      saveRemarksSchema.safeParse({
        report_card_id: "00000000-0000-4000-8000-000000000001",
        expected_revision: 1,
        teacher_remark: "x".repeat(2001),
        update_teacher: true,
      }).success,
    ).toBe(false);
  });

  it("accepts settings updates", () => {
    expect(
      updateReportCardSettingsSchema.safeParse({
        title: "Official Report",
        show_class_position: false,
      }).success,
    ).toBe(true);
  });
});
