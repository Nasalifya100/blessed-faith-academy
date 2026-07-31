import Link from "next/link";

import type { ExaminationCommandCentreSummary } from "@/features/examinations/command-centre";
import {
  PROGRESS_LANE_LABELS,
} from "@/features/examinations/command-centre";
import { STAFF_WORKFLOW_LABELS } from "@/features/examinations/overview";
import {
  gradebookHref,
  reportCardsHref,
  resultsHref,
} from "@/features/examinations/context-links";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function laneTone(state: string): string {
  switch (state) {
    case "complete":
    case "ready":
      return "border-emerald-700/20 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-50";
    case "needs_attention":
    case "blocked":
      return "border-amber-700/30 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-50";
    case "in_progress":
      return "border-sky-700/20 bg-sky-50 text-sky-950 dark:bg-sky-950/20 dark:text-sky-50";
    default:
      return "border-border bg-muted/20 text-foreground";
  }
}

function severityTone(severity: string): string {
  if (severity === "blocking") {
    return "border-amber-700/40 bg-amber-50 dark:bg-amber-950/30";
  }
  if (severity === "needs_attention") {
    return "border-orange-700/30 bg-orange-50/80 dark:bg-orange-950/20";
  }
  return "border-border bg-muted/10";
}

function ReadinessCard({
  summary,
}: {
  summary: ExaminationCommandCentreSummary["resultsReadiness"];
}) {
  return (
    <section className="rounded-2xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{summary.title}</h2>
        <p className="text-sm font-medium" aria-live="polite">
          {summary.label}
          {summary.percent != null ? ` · ${summary.percent}%` : ""}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Guidance only. Server checks still decide what actions are allowed.
      </p>
      {summary.blockers.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {summary.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No blocking readiness issues in this summary.
        </p>
      )}
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {summary.checks
          .filter((c) => c.status !== "na")
          .slice(0, 8)
          .map((c) => (
            <li key={c.id}>
              <span className="font-medium text-foreground">
                {c.status === "pass"
                  ? "Done"
                  : c.status === "warn"
                    ? "Check"
                    : "Missing"}
              </span>
              {" · "}
              {c.label}
            </li>
          ))}
      </ul>
    </section>
  );
}

export function ExaminationCommandCentrePanel({
  centre,
}: {
  centre: ExaminationCommandCentreSummary;
}) {
  const ctx = {
    academicYearId: centre.context.academicYearId,
    termId: centre.context.termId,
  };
  const caps = centre.capabilities;

  return (
    <div className="space-y-6">
      <section
        className="rounded-2xl border bg-muted/10 p-4 sm:p-5"
        aria-labelledby="exam-command-context"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Examination Command Centre
        </p>
        <h2 id="exam-command-context" className="mt-1 text-lg font-semibold">
          {centre.context.academicYearName ?? "No current academic year"}
          {centre.context.termName ? ` · ${centre.context.termName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {centre.context.activePeriodName
            ? `Period: ${centre.context.activePeriodName}`
            : "No open exam period for this year/term yet."}
          {" · "}
          {centre.context.examsCompleted}/{centre.context.examsTotal} exams
          completed
          {" · "}
          Stage: {STAFF_WORKFLOW_LABELS[centre.currentStage]}
        </p>
      </section>

      {centre.emptyState ? (
        <p
          role="status"
          className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
        >
          {centre.emptyState}
        </p>
      ) : null}

      {centre.recommendedAction ? (
        <section className="space-y-3" aria-labelledby="exam-next-action">
          <h2 id="exam-next-action" className="text-base font-semibold">
            Recommended next action
          </h2>
          <Link
            href={centre.recommendedAction.href}
            className="block rounded-2xl border border-foreground/20 bg-muted/20 p-4 transition hover:bg-muted/30"
          >
            <p className="font-medium">{centre.recommendedAction.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {centre.recommendedAction.description}
            </p>
          </Link>
          {centre.secondaryActions.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {centre.secondaryActions.map((action) => (
                <li key={action.id}>
                  <Link
                    href={action.href}
                    className="block rounded-xl border p-3 text-sm transition hover:bg-muted/20"
                  >
                    <span className="font-medium">{action.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {centre.roleView !== "schedule_only" ? (
        <section className="space-y-3" aria-labelledby="exam-progress">
          <h2 id="exam-progress" className="text-base font-semibold">
            Examination progress
          </h2>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {centre.progress.map((lane) => (
              <li
                key={lane.id}
                className={cn(
                  "rounded-xl border px-3 py-3 text-sm",
                  laneTone(lane.state),
                )}
              >
                <p className="font-medium">{lane.label}</p>
                <p className="mt-1 text-xs">
                  <span className="sr-only">Status: </span>
                  {PROGRESS_LANE_LABELS[lane.state]}
                </p>
                <p className="mt-1 text-xs opacity-90">{lane.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {centre.attentionItems.length > 0 ? (
        <section className="space-y-3" aria-labelledby="exam-attention">
          <h2 id="exam-attention" className="text-base font-semibold">
            Needs attention
          </h2>
          <ul className="space-y-2">
            {centre.attentionItems.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  severityTone(item.severity),
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium">{item.issue}</p>
                    {item.scopeLabel ? (
                      <p className="text-xs text-muted-foreground">
                        {item.scopeLabel}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs">
                      <span className="font-medium">
                        {item.severity === "blocking"
                          ? "Blocking"
                          : item.severity === "needs_attention"
                            ? "Needs attention"
                            : "Information"}
                      </span>
                      {" · "}
                      {item.nextStep}
                    </p>
                  </div>
                  <Link
                    href={item.href}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "h-10 shrink-0",
                    )}
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {centre.roleView === "admin" &&
      (caps.canOpenResults || caps.canOpenReportCards) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {caps.canOpenResults || caps.canRecalculateResults ? (
            <ReadinessCard summary={centre.resultsReadiness} />
          ) : null}
          {caps.canOpenReportCards ? (
            <ReadinessCard summary={centre.reportCardReadiness} />
          ) : null}
        </div>
      ) : null}

      {centre.roleView === "admin" && centre.classSummaries.length > 0 ? (
        <section className="space-y-3" aria-labelledby="exam-classes">
          <h2 id="exam-classes" className="text-base font-semibold">
            Class progress
          </h2>
          <p className="text-xs text-muted-foreground">
            Counts only — no student names or marks. Open a class to work in
            Marks, Results, or Report Cards.
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Gradebooks</th>
                  <th className="px-3 py-2 font-medium">Results</th>
                  <th className="px-3 py-2 font-medium">Report cards</th>
                  <th className="px-3 py-2 font-medium">Next</th>
                </tr>
              </thead>
              <tbody>
                {centre.classSummaries.map((row) => (
                  <tr key={row.classId} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {row.gradeName} · {row.className}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.attention === "clear"
                          ? "On track"
                          : row.attention === "blocking"
                            ? "Blocking"
                            : row.attention === "needs_attention"
                              ? "Needs attention"
                              : "Information"}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      {row.gradebooksDraft + row.gradebooksReopened} open ·{" "}
                      {row.gradebooksSubmitted} submitted ·{" "}
                      {row.gradebooksLocked} locked
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.resultState === "not_calculated"
                        ? "Not calculated"
                        : row.resultState === "stale"
                          ? "Outdated"
                          : "Calculated"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.reportCardState === "not_generated"
                        ? "Not generated"
                        : row.reportCardState === "draft"
                          ? "Draft"
                          : row.reportCardState === "approved"
                            ? "Approved"
                            : row.reportCardState === "published"
                              ? "Published"
                              : "Mixed"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={row.href}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "h-9",
                        )}
                      >
                        {row.recommendedTitle}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {centre.roleView === "teacher" ? (
        <section className="space-y-3" aria-labelledby="exam-teacher-work">
          <h2 id="exam-teacher-work" className="text-base font-semibold">
            Your assigned work
          </h2>
          <p className="text-xs text-muted-foreground">
            Only gradebooks you can access. Use a laptop or tablet for large
            mark grids. Blank means missing; zero is a scored mark.
          </p>
          {centre.teacherWork.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No assigned gradebooks yet. Completed exams for your classes will
              appear here.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {centre.teacherWork.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.statusLabel} · {item.detail}
                    </p>
                  </div>
                  <Link
                    href={item.href}
                    className={cn(buttonVariants(), "h-11 shrink-0")}
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <p className="w-full text-sm font-medium text-muted-foreground">
          Workspace
        </p>
        <Link
          href="/dashboard/examinations/upcoming"
          className={cn(buttonVariants({ variant: "outline" }), "h-11")}
        >
          Upcoming exams
        </Link>
        {caps.canManageSetup ? (
          <>
            <Link
              href="/dashboard/examinations/periods/new"
              className={cn(buttonVariants(), "h-11")}
            >
              Create exam period
            </Link>
            <Link
              href="/dashboard/settings/academics"
              className={cn(buttonVariants({ variant: "outline" }), "h-11")}
            >
              Academic settings
            </Link>
          </>
        ) : null}
        {caps.canOpenGradebook ? (
          <Link
            href={gradebookHref(ctx)}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            Marks
          </Link>
        ) : null}
        {caps.canOpenResults ? (
          <Link
            href={resultsHref(ctx)}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            Results
          </Link>
        ) : null}
        {caps.canOpenReportCards ? (
          <Link
            href={reportCardsHref(ctx)}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            Report cards
          </Link>
        ) : null}
      </section>
    </div>
  );
}
