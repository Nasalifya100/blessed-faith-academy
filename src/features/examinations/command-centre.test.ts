import { describe, expect, it } from "vitest";

import {
  aggregateClassSummaries,
  buildCommandCentreFromOverview,
  buildProgressLanes,
  buildReportCardReadiness,
  buildResultsReadiness,
  scoreReadiness,
  type ReadinessCheck,
} from "@/features/examinations/command-centre";
import type { ExaminationsOverviewCounts } from "@/features/examinations/overview";

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

const caps = {
  canManageSetup: true,
  canOpenGradebook: true,
  canViewAllGradebooks: true,
  canOpenResults: true,
  canRecalculateResults: true,
  canOpenReportCards: true,
  canApproveOrPublishReportCards: true,
  canEditReportCardRemarks: true,
};

describe("readiness scoring (presentation only)", () => {
  it("excludes na from denominator and never marks Ready with blockers", () => {
    const checks: ReadinessCheck[] = [
      { id: "a", label: "A", status: "pass", blocking: true },
      { id: "b", label: "B", status: "pass", blocking: true },
      { id: "c", label: "C", status: "pass", blocking: true },
      { id: "d", label: "Blocking miss", status: "fail", blocking: true },
      { id: "e", label: "Optional", status: "na", blocking: false },
    ];
    const scored = scoreReadiness(checks);
    expect(scored.percent).toBe(75);
    expect(scored.ready).toBe(false);
    expect(scored.label).not.toBe("Ready");
    expect(scored.blockers).toContain("Blocking miss");
  });

  it("is Ready only with no blockers", () => {
    const checks: ReadinessCheck[] = [
      { id: "a", label: "A", status: "pass", blocking: true },
      { id: "b", label: "B", status: "pass", blocking: false },
    ];
    const scored = scoreReadiness(checks);
    expect(scored.ready).toBe(true);
    expect(scored.label).toBe("Ready");
    expect(scored.percent).toBe(100);
  });
});

describe("results readiness", () => {
  it("blocks when draft/reopened gradebooks remain", () => {
    const summary = buildResultsReadiness({
      hasYear: true,
      hasTerm: true,
      hasPeriod: true,
      examsTotal: 4,
      examsCompleted: 4,
      gradebooksDraft: 1,
      gradebooksReopened: 0,
      gradebooksSubmitted: 3,
      gradebooksLocked: 0,
      gradebooksNotStarted: 0,
      resultsClassesReady: 0,
      resultsClassesStale: 0,
      schoolWide: true,
    });
    expect(summary.ready).toBe(false);
    expect(summary.blockers.length).toBeGreaterThan(0);
  });

  it("treats not-started as na for non-school-wide viewers", () => {
    const summary = buildResultsReadiness({
      hasYear: true,
      hasTerm: true,
      hasPeriod: true,
      examsTotal: 2,
      examsCompleted: 2,
      gradebooksDraft: 0,
      gradebooksReopened: 0,
      gradebooksSubmitted: 2,
      gradebooksLocked: 0,
      gradebooksNotStarted: 5,
      resultsClassesReady: 1,
      resultsClassesStale: 0,
      schoolWide: false,
    });
    expect(
      summary.checks.find((c) => c.id === "not_started")?.status,
    ).toBe("na");
  });

  it("blocks on stale results even when most checks pass", () => {
    const summary = buildResultsReadiness({
      hasYear: true,
      hasTerm: true,
      hasPeriod: true,
      examsTotal: 3,
      examsCompleted: 3,
      gradebooksDraft: 0,
      gradebooksReopened: 0,
      gradebooksSubmitted: 0,
      gradebooksLocked: 3,
      gradebooksNotStarted: 0,
      resultsClassesReady: 2,
      resultsClassesStale: 1,
      schoolWide: true,
    });
    expect(summary.ready).toBe(false);
    expect(summary.label).not.toBe("Ready");
  });
});

describe("report card readiness", () => {
  it("requires current results", () => {
    const summary = buildReportCardReadiness({
      resultsClassesReady: 0,
      resultsClassesStale: 0,
      reportCardsDraft: 0,
      reportCardsReviewed: 0,
      reportCardsApproved: 0,
      reportCardsPublished: 0,
      canApproveOrPublish: true,
    });
    expect(summary.ready).toBe(false);
  });

  it("blocks when results are stale", () => {
    const summary = buildReportCardReadiness({
      resultsClassesReady: 2,
      resultsClassesStale: 1,
      reportCardsDraft: 5,
      reportCardsReviewed: 0,
      reportCardsApproved: 0,
      reportCardsPublished: 0,
      canApproveOrPublish: true,
    });
    expect(summary.ready).toBe(false);
  });

  it("marks approval check na without approve capability", () => {
    const summary = buildReportCardReadiness({
      resultsClassesReady: 1,
      resultsClassesStale: 0,
      reportCardsDraft: 2,
      reportCardsReviewed: 0,
      reportCardsApproved: 0,
      reportCardsPublished: 0,
      canApproveOrPublish: false,
    });
    expect(summary.checks.find((c) => c.id === "approved")?.status).toBe("na");
  });
});

describe("progress lanes and command centre assembly", () => {
  it("maps incomplete setup to blocked/not started lanes", () => {
    const lanes = buildProgressLanes(emptyCounts, {
      hasYear: false,
      hasTerm: false,
    });
    expect(lanes[0]?.state).toBe("blocked");
  });

  it("builds admin centre without student fields", () => {
    const centre = buildCommandCentreFromOverview({
      roleView: "admin",
      counts: {
        ...emptyCounts,
        examPeriodsActive: 1,
        examsTotal: 2,
        examsCompleted: 2,
        gradebooksSubmitted: 2,
        resultsClassesReady: 1,
      },
      hasYear: true,
      hasTerm: true,
      hasPeriod: true,
      academicYearId: "11111111-1111-4111-8111-111111111111",
      academicYearName: "2026",
      termId: "22222222-2222-4222-8222-222222222222",
      termName: "Term 1",
      activePeriodId: "33333333-3333-4333-8333-333333333333",
      activePeriodName: "Mid-term",
      nextActions: [
        {
          id: "calculate",
          title: "Calculate class results",
          description: "Go",
          href: "/dashboard/results",
          priority: "primary",
        },
      ],
      classSummaries: [],
      teacherWork: [],
      capabilities: caps,
      gradebookHref: "/dashboard/gradebook",
      resultsHref: "/dashboard/results",
      reportCardsHref: "/dashboard/report-cards",
    });
    expect(centre.recommendedAction?.id).toBe("calculate");
    expect(JSON.stringify(centre)).not.toMatch(/fingerprint/i);
    expect(JSON.stringify(centre)).not.toMatch(/admission/i);
  });

  it("hides class summaries and readiness actions for schedule_only", () => {
    const centre = buildCommandCentreFromOverview({
      roleView: "schedule_only",
      counts: emptyCounts,
      hasYear: true,
      hasTerm: true,
      hasPeriod: true,
      academicYearId: "11111111-1111-4111-8111-111111111111",
      academicYearName: "2026",
      termId: "22222222-2222-4222-8222-222222222222",
      termName: "Term 1",
      activePeriodId: null,
      activePeriodName: null,
      nextActions: [
        {
          id: "browse",
          title: "View exam periods",
          description: "Browse",
          href: "/dashboard/examinations/upcoming",
          priority: "primary",
        },
      ],
      classSummaries: [
        {
          classId: "33333333-3333-4333-8333-333333333333",
          className: "A",
          gradeName: "G5",
          gradebooksNotStartedHint: 0,
          gradebooksDraft: 1,
          gradebooksReopened: 0,
          gradebooksSubmitted: 0,
          gradebooksLocked: 0,
          resultState: "not_calculated",
          reportCardState: "not_generated",
          attention: "needs_attention",
          recommendedTitle: "Continue",
          href: "/dashboard/gradebook",
        },
      ],
      teacherWork: [],
      capabilities: {
        ...caps,
        canManageSetup: false,
        canOpenGradebook: false,
        canViewAllGradebooks: false,
        canOpenResults: false,
        canRecalculateResults: false,
        canOpenReportCards: false,
        canApproveOrPublishReportCards: false,
        canEditReportCardRemarks: false,
      },
      gradebookHref: "/dashboard/gradebook",
      resultsHref: "/dashboard/results",
      reportCardsHref: "/dashboard/report-cards",
    });
    expect(centre.classSummaries).toEqual([]);
    expect(centre.attentionItems).toEqual([]);
    expect(centre.emptyState).toMatch(/schedules/i);
  });
});

describe("class aggregate privacy", () => {
  it("aggregates without marks or student names", () => {
    const rows = aggregateClassSummaries({
      classes: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "A",
          grade_name: "Grade 5",
        },
      ],
      gradebooks: [
        {
          class_id: "33333333-3333-4333-8333-333333333333",
          status: "DRAFT",
        },
      ],
      resultByClass: new Map(),
      reportByClass: new Map(),
      academicYearId: "11111111-1111-4111-8111-111111111111",
      termId: "22222222-2222-4222-8222-222222222222",
      resultsHref: () => "/dashboard/results",
      gradebookHref: () => "/dashboard/gradebook",
      reportCardsHref: () => "/dashboard/report-cards",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gradebooksDraft).toBe(1);
    expect(JSON.stringify(rows)).not.toMatch(/marks_obtained|first_name/i);
  });
});
