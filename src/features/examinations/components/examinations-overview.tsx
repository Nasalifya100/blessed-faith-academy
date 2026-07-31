import Link from "next/link";

import type { ExaminationsOverviewModel } from "@/features/examinations/overview";
import { STAFF_WORKFLOW_LABELS } from "@/features/examinations/overview";
import {
  gradebookHref,
  reportCardsHref,
  resultsHref,
} from "@/features/examinations/context-links";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ExaminationsOverviewPanel({
  overview,
}: {
  overview: ExaminationsOverviewModel;
}) {
  const ctx = {
    academicYearId: overview.academicYearId,
    termId: overview.termId,
  };
  const c = overview.counts;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-muted/10 p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Active period
        </p>
        <p className="mt-1 text-lg font-semibold">
          {overview.academicYearName ?? "No current academic year"}
          {overview.termName ? ` · ${overview.termName}` : ""}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {overview.activePeriodName
            ? `Examination: ${overview.activePeriodName}`
            : "No open exam period for this year/term yet."}
          {" · "}
          Progress: {STAFF_WORKFLOW_LABELS[overview.progressStage]}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">What to do next</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {overview.nextActions.map((action) => (
            <li key={action.id}>
              <Link
                href={action.href}
                className={cn(
                  "block h-full rounded-2xl border p-4 transition hover:bg-muted/30",
                  action.priority === "primary" &&
                    "border-foreground/20 bg-muted/20",
                )}
              >
                <p className="font-medium">{action.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {action.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {overview.canManageSetup || overview.canOpenGradebook ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">
            {overview.canViewAllGradebooks
              ? "Setup and marks"
              : "Your marks progress"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {overview.canManageSetup || overview.canViewAllGradebooks ? (
              <>
                <Stat label="Exam periods" value={c.examPeriodsActive} />
                <Stat label="Exams" value={c.examsTotal} />
                <Stat label="Completed exams" value={c.examsCompleted} />
              </>
            ) : null}
            {overview.canOpenGradebook && overview.canViewAllGradebooks ? (
              <Stat
                label="Exams with no gradebook yet"
                value={c.gradebooksNotStarted}
              />
            ) : null}
            {overview.canOpenGradebook ? (
              <>
                <Stat
                  label="In progress"
                  value={c.gradebooksDraft + c.gradebooksReopened}
                />
                <Stat label="Submitted" value={c.gradebooksSubmitted} />
                <Stat label="Locked" value={c.gradebooksLocked} />
              </>
            ) : null}
          </div>
          {overview.canOpenGradebook && !overview.canViewAllGradebooks ? (
            <p className="text-xs text-muted-foreground">
              Counts show gradebooks you can access. Open Marks for assigned
              classes — use a laptop or tablet for large mark grids.
            </p>
          ) : null}
        </section>
      ) : null}

      {overview.canOpenResults || overview.canOpenReportCards ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Results and report cards</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {overview.canOpenResults ? (
              <>
                <Stat
                  label="Classes with results"
                  value={c.resultsClassesReady}
                />
                <Stat
                  label="Outdated results"
                  value={c.resultsClassesStale}
                />
              </>
            ) : null}
            {overview.canOpenReportCards ? (
              <>
                <Stat label="Draft report cards" value={c.reportCardsDraft} />
                <Stat label="Published" value={c.reportCardsPublished} />
              </>
            ) : null}
          </div>
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
        {overview.canManageSetup ? (
          <>
            <Link
              href="/dashboard/examinations/periods/new"
              className={cn(buttonVariants(), "h-11")}
            >
              Create exam period
            </Link>
            <Link
              href="/dashboard/examinations/rooms"
              className={cn(buttonVariants({ variant: "outline" }), "h-11")}
            >
              Rooms
            </Link>
            <Link
              href="/dashboard/examinations/print"
              className={cn(buttonVariants({ variant: "outline" }), "h-11")}
            >
              Print timetables
            </Link>
            <Link
              href="/dashboard/settings/academics"
              className={cn(buttonVariants({ variant: "outline" }), "h-11")}
            >
              Academic settings
            </Link>
          </>
        ) : null}
        {overview.canOpenGradebook ? (
          <Link
            href={gradebookHref(ctx)}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            Marks
          </Link>
        ) : null}
        {overview.canOpenResults ? (
          <Link
            href={resultsHref(ctx)}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            Results
          </Link>
        ) : null}
        {overview.canOpenReportCards ? (
          <Link
            href={reportCardsHref(ctx)}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            Report cards
          </Link>
        ) : null}
      </section>

      {!overview.canOpenGradebook &&
      !overview.canOpenResults &&
      !overview.canOpenReportCards ? (
        <p className="text-sm text-muted-foreground">
          You can view examination schedules and rooms. Marks entry, results, and
          report cards are limited to teaching and academic leadership roles.
        </p>
      ) : null}
    </div>
  );
}
