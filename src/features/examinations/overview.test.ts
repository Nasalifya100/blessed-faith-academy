import { describe, expect, it } from "vitest";

import {
  examPeriodHref,
  gradebookHref,
  reportCardsHref,
  resultsHref,
} from "@/features/examinations/context-links";
import {
  buildOverviewNextActions,
  inferProgressStage,
  STAFF_WORKFLOW_LABELS,
  type ExaminationsOverviewCounts,
} from "@/features/examinations/overview";
import { EXAM_PERIOD_STATUS_LABELS } from "@/features/examinations/schemas";
import { REPORT_CARD_STATUS_LABELS } from "@/features/report-cards/types";
import { normalizeGradebookError } from "@/features/gradebook/errors";

const emptyCounts: ExaminationsOverviewCounts = {
  examPeriodsActive: 0,
  examsTotal: 0,
  examsCompleted: 0,
  examsReady: 0,
  gradebooksNotStarted: 0,
  gradebooksDraft: 0,
  gradebooksReopened: 0,
  gradebooksSubmitted: 0,
  gradebooksLocked: 0,
  resultsClassesReady: 0,
  resultsClassesStale: 0,
  reportCardsDraft: 0,
  reportCardsReviewed: 0,
  reportCardsApproved: 0,
  reportCardsPublished: 0,
};

const baseActionInput = {
  canManageSetup: false,
  canOpenGradebook: false,
  canViewAllGradebooks: false,
  canOpenResults: false,
  canRecalculateResults: false,
  canOpenReportCards: false,
  canApproveOrPublishReportCards: false,
  canEditReportCardRemarks: false,
  academicYearId: null as string | null,
  termId: null as string | null,
  activePeriodId: null as string | null,
  counts: emptyCounts,
  gradebookHref: "/dashboard/gradebook",
  resultsHref: "/dashboard/results",
  reportCardsHref: "/dashboard/report-cards",
  settingsHref: "/dashboard/settings/academics",
};

describe("examinations context links", () => {
  it("preserves year/term/class across hubs", () => {
    const ctx = {
      academicYearId: "11111111-1111-4111-8111-111111111111",
      termId: "22222222-2222-4222-8222-222222222222",
      classId: "33333333-3333-4333-8333-333333333333",
    };
    expect(gradebookHref(ctx)).toContain("year=");
    expect(gradebookHref(ctx)).toContain("term=");
    expect(gradebookHref(ctx)).toContain("class=");
    expect(resultsHref(ctx)).toContain("academic_year_id=");
    expect(resultsHref(ctx)).toContain("class_id=");
    expect(reportCardsHref(ctx)).toContain("term_id=");
  });

  it("rejects non-UUID and off-dashboard path injection", () => {
    expect(gradebookHref({ academicYearId: "../evil" })).toBe(
      "/dashboard/gradebook",
    );
    expect(gradebookHref({ academicYearId: "not-a-uuid" })).toBe(
      "/dashboard/gradebook",
    );
    expect(examPeriodHref("../admin")).toBe("/dashboard/examinations");
    expect(
      examPeriodHref("11111111-1111-4111-8111-111111111111"),
    ).toBe(
      "/dashboard/examinations/periods/11111111-1111-4111-8111-111111111111",
    );
    expect(resultsHref({ academicYearId: "https://evil.example" })).toBe(
      "/dashboard/results",
    );
  });
});

describe("examinations overview helpers", () => {
  it("infers published stage when report cards are published", () => {
    expect(
      inferProgressStage({
        ...emptyCounts,
        reportCardsPublished: 3,
      }),
    ).toBe("PUBLISHED");
    expect(STAFF_WORKFLOW_LABELS.PUBLISHED).toBe("Published");
  });

  it("prioritises setup when no periods exist for managers", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canManageSetup: true,
      canOpenGradebook: true,
      canOpenResults: true,
      canRecalculateResults: true,
      canOpenReportCards: true,
      canApproveOrPublishReportCards: true,
    });
    expect(actions[0]?.id).toBe("create-period");
  });

  it("prioritises marks entry for teachers with drafts", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canOpenGradebook: true,
      canOpenResults: true,
      canOpenReportCards: true,
      canEditReportCardRemarks: true,
      academicYearId: "11111111-1111-4111-8111-111111111111",
      termId: "22222222-2222-4222-8222-222222222222",
      activePeriodId: "33333333-3333-4333-8333-333333333333",
      counts: { ...emptyCounts, examPeriodsActive: 1, gradebooksDraft: 2 },
    });
    expect(actions[0]?.id).toBe("marks");
  });

  it("does not offer Calculate to teachers who cannot recalculate", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canOpenGradebook: true,
      canOpenResults: true,
      canRecalculateResults: false,
      counts: {
        ...emptyCounts,
        gradebooksSubmitted: 2,
        resultsClassesReady: 0,
      },
    });
    expect(actions.some((a) => a.id === "calculate")).toBe(false);
    expect(actions.some((a) => /calculate/i.test(a.title))).toBe(false);
  });

  it("offers View outdated results instead of Calculate for teachers", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canOpenResults: true,
      canRecalculateResults: false,
      counts: {
        ...emptyCounts,
        resultsClassesStale: 1,
        resultsClassesReady: 0,
      },
    });
    expect(actions.some((a) => a.id === "results-stale")).toBe(true);
    expect(actions.some((a) => a.id === "calculate")).toBe(false);
  });

  it("does not offer Approve/Publish report-card actions to teachers", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canOpenReportCards: true,
      canApproveOrPublishReportCards: false,
      canEditReportCardRemarks: true,
      counts: {
        ...emptyCounts,
        resultsClassesReady: 2,
        reportCardsDraft: 4,
      },
    });
    expect(actions.some((a) => a.id === "report-cards")).toBe(false);
    expect(actions.some((a) => a.id === "report-cards-teacher")).toBe(true);
    expect(actions.some((a) => /approve|publish and print/i.test(a.title))).toBe(
      false,
    );
  });

  it("offers Open marks entry for teachers without inventing not-started counts", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canOpenGradebook: true,
      canViewAllGradebooks: false,
      counts: {
        ...emptyCounts,
        examsCompleted: 3,
        gradebooksNotStarted: 0,
      },
    });
    expect(actions[0]?.id).toBe("marks");
    expect(actions[0]?.title).toBe("Open marks entry");
  });

  it("lets recalculators see Calculate when submitted and no fresh results", () => {
    const actions = buildOverviewNextActions({
      ...baseActionInput,
      canRecalculateResults: true,
      canOpenResults: true,
      counts: {
        ...emptyCounts,
        gradebooksSubmitted: 1,
        resultsClassesReady: 0,
      },
    });
    expect(actions.some((a) => a.id === "calculate")).toBe(true);
  });
});

describe("staff-facing terminology", () => {
  it("avoids Completed collision for period CLOSED", () => {
    expect(EXAM_PERIOD_STATUS_LABELS.CLOSED).toBe("Closed");
    expect(Object.values(EXAM_PERIOD_STATUS_LABELS)).not.toContain(
      "Completed",
    );
  });

  it("exposes human report-card status labels", () => {
    expect(REPORT_CARD_STATUS_LABELS.PUBLISHED).toBe("Published");
    expect(REPORT_CARD_STATUS_LABELS.DRAFT).toBe("Draft");
  });

  it("maps revision conflicts to refresh language", () => {
    const err = normalizeGradebookError("revision conflict");
    expect(err.code).toBe("REVISION_CONFLICT");
    expect(err.message.toLowerCase()).toContain("refresh");
    expect(err.message.toLowerCase()).not.toContain("rpc");
    expect(err.message.toLowerCase()).not.toContain("fingerprint");
  });
});
