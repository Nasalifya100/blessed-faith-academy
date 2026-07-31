import Link from "next/link";

import { RecalculateResultsButton } from "@/features/results/components/recalculate-button";
import { ResultsStatsCards } from "@/features/results/components/results-stats-cards";
import type {
  ClassResultsBundle,
  ResultsHubContext,
} from "@/features/results/queries";
import { filterPanelClassName } from "@/components/ui/admin-chrome";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ResultsDashboard(props: {
  hub: ResultsHubContext;
  filters: {
    academicYearId: string;
    termId: string;
    classId: string;
    subjectId: string;
  };
  bundle: ClassResultsBundle | null;
}) {
  const { hub, filters, bundle } = props;
  const termsForYear = hub.terms.filter(
    (t) => t.academic_year_id === filters.academicYearId,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Academic Results
          </h1>
          <p className="text-sm text-muted-foreground">
            Calculate class results from submitted gradebooks using the school
            grading scheme. After results are current, continue to Report Cards.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hub.canRecalculate && filters.classId ? (
            <RecalculateResultsButton
              academicYearId={filters.academicYearId}
              termId={filters.termId}
              classId={filters.classId}
            />
          ) : null}
          {filters.classId ? (
            <Link
              href={`/dashboard/report-cards?academic_year_id=${filters.academicYearId}&term_id=${filters.termId}&class_id=${filters.classId}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Report cards
            </Link>
          ) : null}
          <Link
            href={`/dashboard/gradebook?year=${filters.academicYearId}&term=${filters.termId}${filters.classId ? `&class=${filters.classId}` : ""}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Marks
          </Link>
        </div>
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
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Subject filter</span>
          <select
            name="subject_id"
            defaultValue={filters.subjectId}
            className="h-10 rounded-md border bg-background px-3"
          >
            <option value="">All subjects</option>
            {hub.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <button type="submit" className={cn(buttonVariants())}>
            Apply filters
          </button>
        </div>
      </form>

      {!filters.classId ? (
        <p className="text-sm text-muted-foreground">
          Select a class to view term summaries and statistics.
        </p>
      ) : (
        <>
          {bundle?.isStale ? (
            <div
              role="status"
              className="rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-50"
            >
              Marks changed after these results were calculated, or a gradebook
              was reopened. Calculate the results again before generating report
              cards.
            </div>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-medium">Class summary</h2>
              {bundle?.computedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last computed {new Date(bundle.computedAt).toLocaleString()}
                  {bundle.engineVersion
                    ? ` · engine ${bundle.engineVersion}`
                    : ""}
                </p>
              ) : null}
            </div>
            <ResultsStatsCards stats={bundle?.classStatistics ?? null} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Term standings</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pos</th>
                    <th className="px-3 py-2 font-medium">Student</th>
                    <th className="px-3 py-2 font-medium">Average</th>
                    <th className="px-3 py-2 font-medium">Grade</th>
                    <th className="px-3 py-2 font-medium">
                      Promotion (recommendation)
                    </th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {(bundle?.termResults ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-muted-foreground"
                      >
                        No computed term results yet.
                      </td>
                    </tr>
                  ) : (
                    bundle?.termResults.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2 tabular-nums">
                          {row.overall_position ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.student_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.admission_number}
                          </div>
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.average_percentage ?? "—"}
                          {row.average_percentage != null ? "%" : ""}
                        </td>
                        <td className="px-3 py-2">
                          {row.grade_code ?? "—"}
                          {row.grade_label ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {row.grade_label}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <div>{row.promotion_outcome}</div>
                          {row.promotion_reason ? (
                            <div className="text-xs text-muted-foreground">
                              {row.promotion_reason}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/dashboard/results/students/${row.student_id}?academic_year_id=${filters.academicYearId}&term_id=${filters.termId}&class_id=${filters.classId}`}
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" }),
                            )}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Subject results</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Subject</th>
                    <th className="px-3 py-2 font-medium">Student</th>
                    <th className="px-3 py-2 font-medium">Pos</th>
                    <th className="px-3 py-2 font-medium">%</th>
                    <th className="px-3 py-2 font-medium">Grade</th>
                    <th className="px-3 py-2 font-medium">Pass</th>
                  </tr>
                </thead>
                <tbody>
                  {(bundle?.subjectResults ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-muted-foreground"
                      >
                        No subject results for this filter.
                      </td>
                    </tr>
                  ) : (
                    bundle?.subjectResults.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">{row.subject_name}</td>
                        <td className="px-3 py-2">{row.student_name}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.subject_position ?? "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.weighted_percentage ?? "—"}
                        </td>
                        <td className="px-3 py-2">{row.grade_code ?? "—"}</td>
                        <td className="px-3 py-2">
                          {row.is_pass == null
                            ? "—"
                            : row.is_pass
                              ? "Pass"
                              : "Fail"}
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
