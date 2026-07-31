/**
 * Examination Command Centre — presentation-only helpers.
 *
 * IMPORTANT:
 * - These summaries guide staff; they are NOT workflow gates.
 * - Server actions / SECURITY DEFINER RPCs remain authoritative.
 * - Readiness percentages must never be accepted as action input.
 * - No marks, student names, fingerprints, or RPC names in outputs.
 */

import type {
  ExaminationsOverviewCounts,
  OverviewNextAction,
  StaffWorkflowStage,
} from "@/features/examinations/overview";
import { inferProgressStage } from "@/features/examinations/overview";

export type CommandRoleView = "admin" | "teacher" | "schedule_only";

export type ProgressLaneState =
  | "not_started"
  | "in_progress"
  | "ready"
  | "complete"
  | "needs_attention"
  | "blocked";

export const PROGRESS_LANE_LABELS: Record<ProgressLaneState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  ready: "Ready",
  complete: "Complete",
  needs_attention: "Needs attention",
  blocked: "Blocked",
};

export type ProgressLane = {
  id: string;
  label: string;
  state: ProgressLaneState;
  detail: string;
};

export type ReadinessCheckStatus = "pass" | "fail" | "warn" | "na";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessCheckStatus;
  /** When true, a fail/warn blocks the staff-facing Ready label. */
  blocking: boolean;
  /** Optional check weight; default 1. Non-applicable (na) excluded from denominator. */
  weight?: number;
};

export type ReadinessLabel =
  | "Not ready"
  | "Needs attention"
  | "Almost ready"
  | "Ready";

/**
 * PRESENTATION-ONLY scoring rules:
 * 1. Applicable checks = status !== "na".
 * 2. Each applicable check contributes `weight` (default 1).
 * 3. percent = round(100 * sum(pass weights) / sum(applicable weights)).
 * 4. Ready ONLY when there are zero blocking fail/warn checks.
 * 5. A high percent NEVER overrides a critical blocker.
 * 6. Scores must never enable Calculate / Approve / Publish.
 */
export type ReadinessSummary = {
  title: string;
  percent: number | null;
  label: ReadinessLabel;
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: string[];
  notes: string[];
};

export type AttentionSeverity = "blocking" | "needs_attention" | "information";

export type AttentionItem = {
  id: string;
  issue: string;
  severity: AttentionSeverity;
  href: string;
  nextStep: string;
  scopeLabel?: string;
};

export type ClassCommandSummary = {
  classId: string;
  className: string;
  gradeName: string;
  gradebooksNotStartedHint: number;
  gradebooksDraft: number;
  gradebooksReopened: number;
  gradebooksSubmitted: number;
  gradebooksLocked: number;
  resultState: "not_calculated" | "calculated" | "stale";
  reportCardState:
    | "not_generated"
    | "draft"
    | "approved"
    | "published"
    | "mixed";
  attention: AttentionSeverity | "clear";
  recommendedTitle: string;
  href: string;
};

export type TeacherWorkItem = {
  id: string;
  title: string;
  statusLabel: string;
  href: string;
  detail: string;
};

export type ExaminationCommandCentreSummary = {
  roleView: CommandRoleView;
  context: {
    academicYearId: string | null;
    academicYearName: string | null;
    termId: string | null;
    termName: string | null;
    activePeriodId: string | null;
    activePeriodName: string | null;
    examsTotal: number;
    examsCompleted: number;
  };
  currentStage: StaffWorkflowStage;
  progress: ProgressLane[];
  resultsReadiness: ReadinessSummary;
  reportCardReadiness: ReadinessSummary;
  classSummaries: ClassCommandSummary[];
  attentionItems: AttentionItem[];
  recommendedAction: OverviewNextAction | null;
  secondaryActions: OverviewNextAction[];
  teacherWork: TeacherWorkItem[];
  emptyState: string | null;
  /** Capability flags for UI gating only. */
  capabilities: {
    canManageSetup: boolean;
    canOpenGradebook: boolean;
    canViewAllGradebooks: boolean;
    canOpenResults: boolean;
    canRecalculateResults: boolean;
    canOpenReportCards: boolean;
    canApproveOrPublishReportCards: boolean;
    canEditReportCardRemarks: boolean;
  };
};

export function scoreReadiness(checks: ReadinessCheck[]): {
  percent: number | null;
  label: ReadinessLabel;
  ready: boolean;
  blockers: string[];
} {
  const applicable = checks.filter((c) => c.status !== "na");
  if (applicable.length === 0) {
    return {
      percent: null,
      label: "Not ready",
      ready: false,
      blockers: [],
    };
  }

  let passWeight = 0;
  let totalWeight = 0;
  const blockers: string[] = [];

  for (const check of applicable) {
    const w = check.weight ?? 1;
    totalWeight += w;
    if (check.status === "pass") {
      passWeight += w;
    } else if (check.blocking && (check.status === "fail" || check.status === "warn")) {
      blockers.push(check.label);
    }
  }

  const percent =
    totalWeight === 0 ? null : Math.round((100 * passWeight) / totalWeight);
  const ready = blockers.length === 0;

  let label: ReadinessLabel;
  if (!ready) {
    label =
      percent != null && percent >= 80 ? "Needs attention" : "Not ready";
  } else if (percent != null && percent < 100) {
    label = "Almost ready";
  } else {
    label = "Ready";
  }

  // Critical rule: never Ready when blockers exist, even if percent rounds to 100.
  if (blockers.length > 0 && label === "Ready") {
    label = "Needs attention";
  }

  return { percent, label, ready: ready && blockers.length === 0, blockers };
}

export function buildProgressLanes(
  counts: ExaminationsOverviewCounts,
  opts: { hasYear: boolean; hasTerm: boolean },
): ProgressLane[] {
  const setupState: ProgressLaneState = !opts.hasYear
    ? "blocked"
    : !opts.hasTerm
      ? "blocked"
      : counts.examPeriodsActive === 0
        ? "not_started"
        : counts.examsCompleted === 0 && counts.examsReady === 0
          ? "in_progress"
          : counts.examsCompleted > 0
            ? "complete"
            : "ready";

  const marksInFlight =
    counts.gradebooksDraft +
    counts.gradebooksReopened +
    counts.gradebooksNotStarted;
  const marksDone =
    counts.gradebooksSubmitted + counts.gradebooksLocked;

  let marksState: ProgressLaneState = "not_started";
  if (counts.gradebooksReopened > 0) marksState = "needs_attention";
  else if (marksInFlight > 0) marksState = "in_progress";
  else if (marksDone > 0 && marksInFlight === 0) marksState = "complete";
  else if (counts.examsCompleted > 0) marksState = "ready";

  let submitState: ProgressLaneState = "not_started";
  if (counts.gradebooksReopened > 0) submitState = "needs_attention";
  else if (counts.gradebooksDraft > 0) submitState = "in_progress";
  else if (counts.gradebooksSubmitted > 0 && counts.gradebooksLocked === 0) {
    submitState = "ready";
  } else if (counts.gradebooksLocked > 0 && counts.gradebooksSubmitted === 0) {
    submitState = "complete";
  } else if (counts.gradebooksSubmitted + counts.gradebooksLocked > 0) {
    submitState = "in_progress";
  }

  let resultsState: ProgressLaneState = "not_started";
  if (counts.resultsClassesStale > 0) resultsState = "needs_attention";
  else if (counts.resultsClassesReady > 0) resultsState = "complete";
  else if (counts.gradebooksSubmitted + counts.gradebooksLocked > 0) {
    resultsState = "ready";
  }

  const rcOpen =
    counts.reportCardsDraft +
    counts.reportCardsReviewed +
    counts.reportCardsApproved;
  let rcState: ProgressLaneState = "not_started";
  if (counts.resultsClassesStale > 0) rcState = "blocked";
  else if (rcOpen > 0 && counts.reportCardsPublished === 0) {
    rcState = "in_progress";
  } else if (counts.reportCardsPublished > 0 && rcOpen === 0) {
    rcState = "complete";
  } else if (counts.resultsClassesReady > 0) {
    rcState = "ready";
  }

  let pubState: ProgressLaneState = "not_started";
  if (counts.reportCardsPublished > 0) pubState = "complete";
  else if (counts.reportCardsApproved > 0) pubState = "ready";
  else if (rcOpen > 0) pubState = "in_progress";

  return [
    {
      id: "setup",
      label: "Setup",
      state: setupState,
      detail: !opts.hasYear
        ? "Set a current academic year first."
        : !opts.hasTerm
          ? "Set a current term first."
          : `${counts.examPeriodsActive} period(s), ${counts.examsCompleted} completed exam(s).`,
    },
    {
      id: "marks",
      label: "Marks entry",
      state: marksState,
      detail:
        marksInFlight > 0
          ? `${marksInFlight} gradebook(s) still open or not started.`
          : marksDone > 0
            ? `${marksDone} gradebook(s) submitted or locked.`
            : "Waiting for completed exams and marks entry.",
    },
    {
      id: "submit_lock",
      label: "Submission and locking",
      state: submitState,
      detail: `${counts.gradebooksSubmitted} submitted · ${counts.gradebooksLocked} locked · ${counts.gradebooksReopened} reopened.`,
    },
    {
      id: "results",
      label: "Results",
      state: resultsState,
      detail:
        counts.resultsClassesStale > 0
          ? `${counts.resultsClassesStale} class(es) have outdated results.`
          : counts.resultsClassesReady > 0
            ? `${counts.resultsClassesReady} class(es) have current results.`
            : "Calculate after gradebooks are submitted or locked.",
    },
    {
      id: "report_cards",
      label: "Report cards",
      state: rcState,
      detail: `${counts.reportCardsDraft} draft · ${counts.reportCardsApproved} approved · ${counts.reportCardsPublished} published.`,
    },
    {
      id: "publication",
      label: "Publication",
      state: pubState,
      detail:
        counts.reportCardsPublished > 0
          ? "Published report cards are available to print."
          : "Publish after approval.",
    },
  ];
}

export function buildResultsReadiness(input: {
  hasYear: boolean;
  hasTerm: boolean;
  hasPeriod: boolean;
  examsTotal: number;
  examsCompleted: number;
  gradebooksDraft: number;
  gradebooksReopened: number;
  gradebooksSubmitted: number;
  gradebooksLocked: number;
  gradebooksNotStarted: number;
  resultsClassesReady: number;
  resultsClassesStale: number;
  /** When false, teacher assignment / school-wide checks are N/A. */
  schoolWide: boolean;
}): ReadinessSummary {
  const submittedOrLocked =
    input.gradebooksSubmitted + input.gradebooksLocked;
  const checks: ReadinessCheck[] = [
    {
      id: "year",
      label: "Current academic year set",
      status: input.hasYear ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "term",
      label: "Current term set",
      status: input.hasTerm ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "period",
      label: "Examination period available",
      status: input.hasPeriod ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "exams",
      label: "Examinations configured",
      status: input.examsTotal > 0 ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "completed",
      label: "Exams marked completed for marks entry",
      status: input.examsCompleted > 0 ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "open_gradebooks",
      label: "No draft or reopened gradebooks blocking calculation",
      status:
        input.gradebooksDraft + input.gradebooksReopened === 0
          ? "pass"
          : "fail",
      blocking: true,
    },
    {
      id: "submitted_sources",
      label: "Submitted or locked gradebooks available",
      status: submittedOrLocked > 0 ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "not_started",
      label: "No completed exams still without a gradebook",
      status: !input.schoolWide
        ? "na"
        : input.gradebooksNotStarted === 0
          ? "pass"
          : "warn",
      blocking: input.schoolWide,
    },
    {
      id: "stale",
      label: "No outdated calculated results",
      status: input.resultsClassesStale === 0 ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "already_calculated",
      label: "Results already calculated for at least one class",
      status: input.resultsClassesReady > 0 ? "pass" : "na",
      blocking: false,
    },
  ];

  const scored = scoreReadiness(checks);
  const notes = [
    "Guidance only — Calculate Results still runs full server validation.",
    "Draft and reopened gradebooks are never treated as calculation sources.",
  ];

  return {
    title: "Results readiness",
    percent: scored.percent,
    label: scored.label,
    ready: scored.ready,
    checks,
    blockers: scored.blockers,
    notes,
  };
}

export function buildReportCardReadiness(input: {
  resultsClassesReady: number;
  resultsClassesStale: number;
  reportCardsDraft: number;
  reportCardsReviewed: number;
  reportCardsApproved: number;
  reportCardsPublished: number;
  canApproveOrPublish: boolean;
}): ReadinessSummary {
  const open =
    input.reportCardsDraft +
    input.reportCardsReviewed +
    input.reportCardsApproved;
  const checks: ReadinessCheck[] = [
    {
      id: "results_exist",
      label: "Current class results exist",
      status: input.resultsClassesReady > 0 ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "results_fresh",
      label: "Results are not outdated",
      status: input.resultsClassesStale === 0 ? "pass" : "fail",
      blocking: true,
    },
    {
      id: "drafts",
      label: "Report card drafts generated",
      status: open + input.reportCardsPublished > 0 ? "pass" : "warn",
      blocking: false,
    },
    {
      id: "approved",
      label: "Cards approved for publication",
      status: !input.canApproveOrPublish
        ? "na"
        : input.reportCardsApproved + input.reportCardsPublished > 0
          ? "pass"
          : open > 0
            ? "warn"
            : "na",
      blocking: false,
    },
    {
      id: "published",
      label: "Cards published",
      status: input.reportCardsPublished > 0 ? "pass" : "na",
      blocking: false,
    },
  ];

  const scored = scoreReadiness(checks);
  return {
    title: "Report card readiness",
    percent: scored.percent,
    label: scored.label,
    ready: scored.ready,
    checks,
    blockers: scored.blockers,
    notes: [
      "Guidance only — generate, approve, and publish still use server checks.",
      "Report cards never recalculate marks.",
    ],
  };
}

export function buildAttentionItems(input: {
  counts: ExaminationsOverviewCounts;
  hasYear: boolean;
  hasTerm: boolean;
  activePeriodId: string | null;
  canManageSetup: boolean;
  canOpenGradebook: boolean;
  canRecalculateResults: boolean;
  canApproveOrPublish: boolean;
  gradebookHref: string;
  resultsHref: string;
  reportCardsHref: string;
  classRows: ClassCommandSummary[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const c = input.counts;

  if (!input.hasYear) {
    items.push({
      id: "no-year",
      issue: "No current academic year is set.",
      severity: "blocking",
      href: "/dashboard/settings",
      nextStep: "Set the current academic year in Settings.",
    });
  }
  if (!input.hasTerm) {
    items.push({
      id: "no-term",
      issue: "No current term is set for the academic year.",
      severity: "blocking",
      href: "/dashboard/settings",
      nextStep: "Set the current term in Settings.",
    });
  }
  if (input.canManageSetup && c.examPeriodsActive === 0) {
    items.push({
      id: "no-period",
      issue: "No examination period is set up for this year/term.",
      severity: "blocking",
      href: "/dashboard/examinations/periods/new",
      nextStep: "Create an exam period and add subjects.",
    });
  }
  if (
    input.canManageSetup &&
    input.activePeriodId &&
    c.examsCompleted === 0 &&
    c.examsTotal > 0
  ) {
    items.push({
      id: "exams-not-completed",
      issue: "Exams exist but none are marked Completed for marks entry.",
      severity: "needs_attention",
      href: `/dashboard/examinations/periods/${input.activePeriodId}`,
      nextStep: "Finish scheduling, then mark exams Completed.",
    });
  }
  if (input.canOpenGradebook && c.gradebooksReopened > 0) {
    items.push({
      id: "reopened",
      issue: `${c.gradebooksReopened} gradebook(s) were reopened and need correction.`,
      severity: "blocking",
      href: input.gradebookHref,
      nextStep: "Fix marks, save, and submit again.",
    });
  }
  if (input.canOpenGradebook && c.gradebooksDraft > 0) {
    items.push({
      id: "drafts",
      issue: `${c.gradebooksDraft} gradebook(s) are still in progress.`,
      severity: "needs_attention",
      href: input.gradebookHref,
      nextStep: "Complete missing entries and submit.",
    });
  }
  if (input.canRecalculateResults && c.resultsClassesStale > 0) {
    items.push({
      id: "stale-results",
      issue: `${c.resultsClassesStale} class(es) have outdated results after marks changed.`,
      severity: "blocking",
      href: input.resultsHref,
      nextStep: "Calculate class results again before report cards.",
    });
  }
  if (
    input.canApproveOrPublish &&
    c.reportCardsDraft + c.reportCardsReviewed > 0 &&
    c.resultsClassesStale === 0
  ) {
    items.push({
      id: "rc-review",
      issue: "Report cards are waiting for review or approval.",
      severity: "needs_attention",
      href: input.reportCardsHref,
      nextStep: "Review remarks, approve, then publish.",
    });
  }

  for (const row of input.classRows.slice(0, 12)) {
    if (row.attention === "clear") continue;
    if (row.resultState === "stale") {
      items.push({
        id: `class-stale-${row.classId}`,
        issue: `${row.gradeName} ${row.className} results are outdated.`,
        severity: "blocking",
        scopeLabel: `${row.gradeName} · ${row.className}`,
        href: row.href,
        nextStep: "Calculate results again for this class.",
      });
    } else if (row.gradebooksReopened > 0 || row.gradebooksDraft > 0) {
      items.push({
        id: `class-marks-${row.classId}`,
        issue: `${row.gradeName} ${row.className} still has open gradebooks.`,
        severity: "needs_attention",
        scopeLabel: `${row.gradeName} · ${row.className}`,
        href: row.href,
        nextStep: "Finish marks entry and submit.",
      });
    }
  }

  // Prefer blockers first, then needs attention, then information.
  const rank: Record<AttentionSeverity, number> = {
    blocking: 0,
    needs_attention: 1,
    information: 2,
  };
  return items
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 12);
}

export function aggregateClassSummaries(input: {
  classes: Array<{ id: string; name: string; grade_name: string }>;
  gradebooks: Array<{ class_id: string; status: string }>;
  resultByClass: Map<string, boolean>; // true = stale
  reportByClass: Map<
    string,
    { draft: number; approved: number; published: number; other: number }
  >;
  academicYearId: string | null;
  termId: string | null;
  resultsHref: (classId: string) => string;
  gradebookHref: (classId: string) => string;
  reportCardsHref: (classId: string) => string;
}): ClassCommandSummary[] {
  const gbByClass = new Map<
    string,
    { draft: number; reopened: number; submitted: number; locked: number }
  >();
  for (const g of input.gradebooks) {
    const cur = gbByClass.get(g.class_id) ?? {
      draft: 0,
      reopened: 0,
      submitted: 0,
      locked: 0,
    };
    if (g.status === "DRAFT") cur.draft += 1;
    else if (g.status === "REOPENED") cur.reopened += 1;
    else if (g.status === "SUBMITTED") cur.submitted += 1;
    else if (g.status === "LOCKED") cur.locked += 1;
    gbByClass.set(g.class_id, cur);
  }

  const rows: ClassCommandSummary[] = [];
  for (const cls of input.classes) {
    const gb = gbByClass.get(cls.id) ?? {
      draft: 0,
      reopened: 0,
      submitted: 0,
      locked: 0,
    };
    const hasResult = input.resultByClass.has(cls.id);
    const stale = input.resultByClass.get(cls.id) === true;
    const resultState: ClassCommandSummary["resultState"] = !hasResult
      ? "not_calculated"
      : stale
        ? "stale"
        : "calculated";

    const rc = input.reportByClass.get(cls.id) ?? {
      draft: 0,
      approved: 0,
      published: 0,
      other: 0,
    };
    let reportCardState: ClassCommandSummary["reportCardState"] =
      "not_generated";
    const kinds = [
      rc.draft > 0,
      rc.approved > 0,
      rc.published > 0,
      rc.other > 0,
    ].filter(Boolean).length;
    if (kinds > 1) reportCardState = "mixed";
    else if (rc.published > 0) reportCardState = "published";
    else if (rc.approved > 0) reportCardState = "approved";
    else if (rc.draft > 0 || rc.other > 0) reportCardState = "draft";

    let attention: ClassCommandSummary["attention"] = "clear";
    let recommendedTitle = "View class progress";
    let href = input.resultsHref(cls.id);

    if (stale) {
      attention = "blocking";
      recommendedTitle = "Recalculate results";
      href = input.resultsHref(cls.id);
    } else if (gb.reopened > 0 || gb.draft > 0) {
      attention = "needs_attention";
      recommendedTitle = "Continue marks entry";
      href = input.gradebookHref(cls.id);
    } else if (!hasResult && gb.submitted + gb.locked > 0) {
      attention = "needs_attention";
      recommendedTitle = "Calculate results";
      href = input.resultsHref(cls.id);
    } else if (hasResult && reportCardState === "not_generated") {
      attention = "information";
      recommendedTitle = "Generate report cards";
      href = input.reportCardsHref(cls.id);
    } else if (reportCardState === "draft" || reportCardState === "approved") {
      attention = "information";
      recommendedTitle = "Review report cards";
      href = input.reportCardsHref(cls.id);
    }

    rows.push({
      classId: cls.id,
      className: cls.name,
      gradeName: cls.grade_name,
      gradebooksNotStartedHint: 0,
      gradebooksDraft: gb.draft,
      gradebooksReopened: gb.reopened,
      gradebooksSubmitted: gb.submitted,
      gradebooksLocked: gb.locked,
      resultState,
      reportCardState,
      attention,
      recommendedTitle,
      href,
    });
  }

  return rows
    .sort((a, b) => {
      const rank = { blocking: 0, needs_attention: 1, information: 2, clear: 3 };
      const d = rank[a.attention] - rank[b.attention];
      if (d !== 0) return d;
      return `${a.gradeName} ${a.className}`.localeCompare(
        `${b.gradeName} ${b.className}`,
      );
    })
    .slice(0, 40);
}

export function buildCommandCentreFromOverview(input: {
  roleView: CommandRoleView;
  counts: ExaminationsOverviewCounts;
  hasYear: boolean;
  hasTerm: boolean;
  hasPeriod: boolean;
  academicYearId: string | null;
  academicYearName: string | null;
  termId: string | null;
  termName: string | null;
  activePeriodId: string | null;
  activePeriodName: string | null;
  nextActions: OverviewNextAction[];
  classSummaries: ClassCommandSummary[];
  teacherWork: TeacherWorkItem[];
  capabilities: ExaminationCommandCentreSummary["capabilities"];
  gradebookHref: string;
  resultsHref: string;
  reportCardsHref: string;
}): ExaminationCommandCentreSummary {
  const counts = input.counts;
  const resultsReadiness = buildResultsReadiness({
    hasYear: input.hasYear,
    hasTerm: input.hasTerm,
    hasPeriod: input.hasPeriod,
    examsTotal: counts.examsTotal,
    examsCompleted: counts.examsCompleted,
    gradebooksDraft: counts.gradebooksDraft,
    gradebooksReopened: counts.gradebooksReopened,
    gradebooksSubmitted: counts.gradebooksSubmitted,
    gradebooksLocked: counts.gradebooksLocked,
    gradebooksNotStarted: counts.gradebooksNotStarted,
    resultsClassesReady: counts.resultsClassesReady,
    resultsClassesStale: counts.resultsClassesStale,
    schoolWide: input.capabilities.canViewAllGradebooks,
  });

  const reportCardReadiness = buildReportCardReadiness({
    resultsClassesReady: counts.resultsClassesReady,
    resultsClassesStale: counts.resultsClassesStale,
    reportCardsDraft: counts.reportCardsDraft,
    reportCardsReviewed: counts.reportCardsReviewed,
    reportCardsApproved: counts.reportCardsApproved,
    reportCardsPublished: counts.reportCardsPublished,
    canApproveOrPublish: input.capabilities.canApproveOrPublishReportCards,
  });

  const attentionItems =
    input.roleView === "schedule_only"
      ? []
      : buildAttentionItems({
          counts,
          hasYear: input.hasYear,
          hasTerm: input.hasTerm,
          activePeriodId: input.activePeriodId,
          canManageSetup: input.capabilities.canManageSetup,
          canOpenGradebook: input.capabilities.canOpenGradebook,
          canRecalculateResults: input.capabilities.canRecalculateResults,
          canApproveOrPublish:
            input.capabilities.canApproveOrPublishReportCards,
          gradebookHref: input.gradebookHref,
          resultsHref: input.resultsHref,
          reportCardsHref: input.reportCardsHref,
          classRows:
            input.roleView === "admin" ? input.classSummaries : [],
        });

  let emptyState: string | null = null;
  if (!input.hasYear) {
    emptyState = "No current academic year is set. An administrator should set it in Settings.";
  } else if (!input.hasTerm) {
    emptyState = "No current term is set. An administrator should set it in Settings.";
  } else if (input.roleView === "schedule_only") {
    emptyState =
      "You can view examination schedules. Marks, results, and report cards are limited to teaching and academic leadership roles.";
  } else if (counts.examPeriodsActive === 0) {
    emptyState = input.capabilities.canManageSetup
      ? "No exam period yet. Create one to start the examination cycle."
      : "No exam period is available yet. An administrator will set this up.";
  }

  return {
    roleView: input.roleView,
    context: {
      academicYearId: input.academicYearId,
      academicYearName: input.academicYearName,
      termId: input.termId,
      termName: input.termName,
      activePeriodId: input.activePeriodId,
      activePeriodName: input.activePeriodName,
      examsTotal: counts.examsTotal,
      examsCompleted: counts.examsCompleted,
    },
    currentStage: inferProgressStage(counts),
    progress: buildProgressLanes(counts, {
      hasYear: input.hasYear,
      hasTerm: input.hasTerm,
    }),
    resultsReadiness,
    reportCardReadiness,
    classSummaries: input.roleView === "admin" ? input.classSummaries : [],
    attentionItems,
    recommendedAction: input.nextActions[0] ?? null,
    secondaryActions: input.nextActions.slice(1, 4),
    teacherWork: input.roleView === "teacher" ? input.teacherWork : [],
    emptyState,
    capabilities: input.capabilities,
  };
}
