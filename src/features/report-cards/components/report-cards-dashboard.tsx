import Link from "next/link";

import { GenerateDraftsButton } from "@/features/report-cards/components/report-card-actions";
import type {
  ClassReadiness,
  ReportCardListItem,
  ReportCardsHubContext,
} from "@/features/report-cards/queries";
import { filterPanelClassName } from "@/components/ui/admin-chrome";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReportCardsDashboard(props: {
  hub: ReportCardsHubContext;
  filters: {
    academicYearId: string;
    termId: string;
    classId: string;
  };
  readiness: ClassReadiness | null;
  cards: ReportCardListItem[] | null;
}) {
  const { hub, filters, readiness, cards } = props;
  const termsForYear = hub.terms.filter(
    (t) => t.academic_year_id === filters.academicYearId,
  );
  const blocked =
    Boolean(readiness?.classIsStale) ||
    (readiness?.missingResults ?? 0) > 0 ||
    !readiness?.coherentFingerprint;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Report Cards</h1>
          <p className="text-sm text-muted-foreground">
            Prepare, approve, publish, and print official term report cards from
            Phase 2D.1 academic result snapshots. Calculation stays in Results.
          </p>
        </div>
        {hub.canApprove || hub.canReview || hub.canEditRemarks ? (
          <div className="flex flex-wrap gap-2">
            {hub.canManageSettings ? (
              <Link
                href="/dashboard/settings/report-cards"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Settings
              </Link>
            ) : null}
            <GenerateDraftsButton
              academicYearId={filters.academicYearId}
              termId={filters.termId}
              classId={filters.classId}
              disabled={blocked || !filters.classId}
            />
          </div>
        ) : null}
      </div>

      <form className={filterPanelClassName()} method="get">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Academic year</span>
          <select
            name="academic_year_id"
            defaultValue={filters.academicYearId}
            className="h-10 rounded-md border bg-background px-3"
          >
            {hub.academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Term</span>
          <select
            name="term_id"
            defaultValue={filters.termId}
            className="h-10 rounded-md border bg-background px-3"
          >
            {termsForYear.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Class</span>
          <select
            name="class_id"
            defaultValue={filters.classId}
            className="h-10 rounded-md border bg-background px-3"
          >
            <option value="">Select class</option>
            {hub.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.grade_name} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className={cn(buttonVariants())}>
            Apply filters
          </button>
        </div>
      </form>

      {!filters.classId ? (
        <p className="text-sm text-muted-foreground">
          Select a class to review report-card readiness.
        </p>
      ) : (
        <>
          {readiness?.classIsStale ? (
            <div
              role="status"
              className="rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-50"
            >
              Class results are stale or inconsistent. Recalculate Results before
              generating or approving report cards.
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Eligible students" value={readiness?.eligibleStudents} />
            <Stat label="Results ready" value={readiness?.resultsReady} />
            <Stat label="Missing results" value={readiness?.missingResults} />
            <Stat label="Published" value={readiness?.published} />
            <Stat label="Drafts" value={readiness?.drafts} />
            <Stat label="Reviewed" value={readiness?.reviewed} />
            <Stat label="Approved" value={readiness?.approved} />
            <Stat label="Outdated drafts" value={readiness?.outdated} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Student report cards</h2>
              {hub.canPrint && (cards?.length ?? 0) > 0 ? (
                <Link
                  href={`/dashboard/report-cards/print?academic_year_id=${filters.academicYearId}&term_id=${filters.termId}&class_id=${filters.classId}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Bulk print
                </Link>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Student</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Remarks</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {(cards ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-muted-foreground"
                      >
                        No report cards yet. Generate drafts after Results are
                        current.
                      </td>
                    </tr>
                  ) : (
                    cards?.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.student_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.admission_number}
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.status}</td>
                        <td className="px-3 py-2 text-xs">
                          T: {row.teacher_remark ? "Yes" : "—"} · H:{" "}
                          {row.headteacher_remark ? "Yes" : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.source_is_outdated ? "Outdated" : "Current"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/dashboard/report-cards/${row.id}`}
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" }),
                            )}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}
