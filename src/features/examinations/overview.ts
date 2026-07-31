/**
 * Staff-facing examinations workflow helpers (UI only).
 * Does not replace authoritative DB lifecycle enums.
 */

export const STAFF_WORKFLOW_STAGES = [
  "SETUP",
  "MARKS_ENTRY",
  "SUBMITTED",
  "LOCKED",
  "RESULTS_READY",
  "REPORT_CARDS",
  "PUBLISHED",
] as const;

export type StaffWorkflowStage = (typeof STAFF_WORKFLOW_STAGES)[number];

export const STAFF_WORKFLOW_LABELS: Record<StaffWorkflowStage, string> = {
  SETUP: "Setup",
  MARKS_ENTRY: "Marks entry",
  SUBMITTED: "Submitted",
  LOCKED: "Locked",
  RESULTS_READY: "Results ready",
  REPORT_CARDS: "Report cards",
  PUBLISHED: "Published",
};

export type OverviewNextAction = {
  id: string;
  title: string;
  description: string;
  href: string;
  priority: "primary" | "secondary";
};

export type ExaminationsOverviewCounts = {
  examPeriodsActive: number;
  examsTotal: number;
  examsCompleted: number;
  examsReady: number;
  gradebooksNotStarted: number;
  gradebooksDraft: number;
  gradebooksReopened: number;
  gradebooksSubmitted: number;
  gradebooksLocked: number;
  resultsClassesReady: number;
  resultsClassesStale: number;
  reportCardsDraft: number;
  reportCardsReviewed: number;
  reportCardsApproved: number;
  reportCardsPublished: number;
};

export type ExaminationsOverviewModel = {
  role: string;
  canManageSetup: boolean;
  canOpenGradebook: boolean;
  canViewAllGradebooks: boolean;
  canOpenResults: boolean;
  canRecalculateResults: boolean;
  canOpenReportCards: boolean;
  canApproveOrPublishReportCards: boolean;
  canEditReportCardRemarks: boolean;
  academicYearId: string | null;
  academicYearName: string | null;
  termId: string | null;
  termName: string | null;
  activePeriodId: string | null;
  activePeriodName: string | null;
  counts: ExaminationsOverviewCounts;
  nextActions: OverviewNextAction[];
  progressStage: StaffWorkflowStage;
};

export function inferProgressStage(
  counts: ExaminationsOverviewCounts,
): StaffWorkflowStage {
  if (counts.reportCardsPublished > 0) return "PUBLISHED";
  if (
    counts.reportCardsDraft +
      counts.reportCardsReviewed +
      counts.reportCardsApproved >
    0
  ) {
    return "REPORT_CARDS";
  }
  if (counts.resultsClassesReady > 0 && counts.resultsClassesStale === 0) {
    return "RESULTS_READY";
  }
  if (counts.gradebooksLocked > 0 && counts.gradebooksSubmitted === 0) {
    return "LOCKED";
  }
  if (counts.gradebooksSubmitted + counts.gradebooksLocked > 0) {
    return "SUBMITTED";
  }
  if (
    counts.gradebooksDraft +
      counts.gradebooksReopened +
      counts.gradebooksNotStarted >
    0
  ) {
    return "MARKS_ENTRY";
  }
  return "SETUP";
}

export function buildOverviewNextActions(input: {
  canManageSetup: boolean;
  canOpenGradebook: boolean;
  canViewAllGradebooks: boolean;
  canOpenResults: boolean;
  canRecalculateResults: boolean;
  canOpenReportCards: boolean;
  canApproveOrPublishReportCards: boolean;
  canEditReportCardRemarks: boolean;
  academicYearId: string | null;
  termId: string | null;
  activePeriodId: string | null;
  counts: ExaminationsOverviewCounts;
  gradebookHref: string;
  resultsHref: string;
  reportCardsHref: string;
  settingsHref: string;
}): OverviewNextAction[] {
  const actions: OverviewNextAction[] = [];
  const c = input.counts;
  const marksInFlight =
    c.gradebooksDraft + c.gradebooksReopened + c.gradebooksNotStarted;

  if (input.canManageSetup && c.examPeriodsActive === 0) {
    actions.push({
      id: "create-period",
      title: "Complete examination setup",
      description: "Create an exam period, add subjects, and schedule sittings.",
      href: "/dashboard/examinations/periods/new",
      priority: "primary",
    });
  } else if (
    input.canManageSetup &&
    input.activePeriodId &&
    c.examsCompleted === 0 &&
    c.examsReady === 0
  ) {
    actions.push({
      id: "finish-setup",
      title: "Finish examination setup",
      description:
        "Add exams, schedule dates, then mark them Completed so marks entry can open.",
      href: `/dashboard/examinations/periods/${input.activePeriodId}`,
      priority: "primary",
    });
  }

  if (input.canOpenGradebook && marksInFlight > 0) {
    actions.push({
      id: "marks",
      title:
        c.gradebooksReopened > 0
          ? "Review reopened gradebooks"
          : c.gradebooksDraft > 0 || !input.canViewAllGradebooks
            ? "Continue entering marks"
            : "Start marks entry",
      description:
        c.gradebooksReopened > 0
          ? "Some gradebooks were reopened and need correction before results."
          : "Enter marks for completed exams, then submit when every student has a mark or status.",
      href: input.gradebookHref,
      priority: actions.length === 0 ? "primary" : "secondary",
    });
  } else if (
    input.canOpenGradebook &&
    !input.canViewAllGradebooks &&
    c.examsCompleted > 0 &&
    c.gradebooksDraft + c.gradebooksReopened + c.gradebooksSubmitted + c.gradebooksLocked ===
      0
  ) {
    // Teachers: exam-level “not started” is unsafe (exam×class). Offer marks without a count claim.
    actions.push({
      id: "marks",
      title: "Open marks entry",
      description:
        "Open your assigned gradebooks for completed exams. Blank means missing; zero is a scored mark.",
      href: input.gradebookHref,
      priority: actions.length === 0 ? "primary" : "secondary",
    });
  }

  if (
    input.canOpenGradebook &&
    c.gradebooksDraft + c.gradebooksReopened === 0 &&
    c.gradebooksNotStarted === 0 &&
    c.gradebooksSubmitted > 0
  ) {
    actions.push({
      id: "submitted",
      title: "Review submitted gradebooks",
      description: input.canRecalculateResults
        ? "Submitted gradebooks are ready for locking and results calculation."
        : "Your submitted gradebooks are read-only until an authorised reopen.",
      href: input.gradebookHref,
      priority: "secondary",
    });
  }

  if (
    input.canRecalculateResults &&
    (c.gradebooksSubmitted > 0 || c.gradebooksLocked > 0) &&
    (c.resultsClassesReady === 0 || c.resultsClassesStale > 0)
  ) {
    actions.push({
      id: "calculate",
      title:
        c.resultsClassesStale > 0
          ? "Recalculate outdated results"
          : "Calculate class results",
      description:
        c.resultsClassesStale > 0
          ? "Marks changed after the last calculation. Calculate again before report cards."
          : "Calculate grades, rankings, and recommendations from submitted gradebooks.",
      href: input.resultsHref,
      priority: actions.length === 0 ? "primary" : "secondary",
    });
  } else if (
    input.canOpenResults &&
    !input.canRecalculateResults &&
    c.resultsClassesStale > 0
  ) {
    actions.push({
      id: "results-stale",
      title: "View outdated results",
      description:
        "Marks changed after results were calculated. An administrator must calculate again before report cards.",
      href: input.resultsHref,
      priority: "secondary",
    });
  } else if (
    input.canOpenResults &&
    !input.canRecalculateResults &&
    c.resultsClassesReady > 0
  ) {
    actions.push({
      id: "view-results",
      title: "View class results",
      description: "Review grades and rankings for your assigned classes.",
      href: input.resultsHref,
      priority: "secondary",
    });
  }

  if (
    input.canApproveOrPublishReportCards &&
    c.resultsClassesReady > 0 &&
    c.resultsClassesStale === 0 &&
    c.reportCardsPublished === 0
  ) {
    actions.push({
      id: "report-cards",
      title:
        c.reportCardsApproved > 0
          ? "Publish and print report cards"
          : c.reportCardsDraft + c.reportCardsReviewed > 0
            ? "Review and approve report cards"
            : "Generate report cards",
      description:
        "Report cards use calculated results only. Review remarks, approve, then publish.",
      href: input.reportCardsHref,
      priority: actions.length === 0 ? "primary" : "secondary",
    });
  } else if (
    input.canOpenReportCards &&
    !input.canApproveOrPublishReportCards &&
    (input.canEditReportCardRemarks || c.reportCardsPublished > 0)
  ) {
    actions.push({
      id: "report-cards-teacher",
      title:
        c.reportCardsPublished > 0
          ? "Print published report cards"
          : "Add remarks on report cards",
      description:
        c.reportCardsPublished > 0
          ? "Open report cards for classes you can access."
          : "Add teacher remarks where drafts exist. Approval and publishing stay with academic leadership.",
      href: input.reportCardsHref,
      priority: "secondary",
    });
  }

  if (input.canManageSetup) {
    actions.push({
      id: "settings",
      title: "Examination settings",
      description:
        "Grading scale, assessment types, weights, and academic dates.",
      href: input.settingsHref,
      priority: "secondary",
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "browse",
      title: "View exam periods",
      description: "Browse schedules and examination status for this term.",
      href: "/dashboard/examinations/upcoming",
      priority: "primary",
    });
  }

  return actions.slice(0, 6);
}
