import Link from "next/link";
import { redirect } from "next/navigation";

import { getStudentTermResultDetail } from "@/features/results/queries";
import { canOpenResults } from "@/features/results/permissions";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StudentResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenResults(current.profile.role)) {
    redirect("/dashboard");
  }

  const { studentId } = await params;
  const sp = await searchParams;
  const academicYearId =
    typeof sp.academic_year_id === "string" ? sp.academic_year_id : "";
  const termId = typeof sp.term_id === "string" ? sp.term_id : "";
  const classId = typeof sp.class_id === "string" ? sp.class_id : "";

  if (!academicYearId || !termId || !classId) {
    redirect("/dashboard/results");
  }

  const detail = await getStudentTermResultDetail({
    academicYearId,
    termId,
    classId,
    studentId,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Student results
          </h1>
          <p className="text-sm text-muted-foreground">
            {detail?.term?.student_name ?? "Student"} · term summary from the
            results engine
          </p>
        </div>
        <Link
          href={`/dashboard/results?academic_year_id=${academicYearId}&term_id=${termId}&class_id=${classId}`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to class
        </Link>
      </div>

      {detail?.isStale ? (
        <div
          role="status"
          className="rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-50"
        >
          These results may be outdated. Recalculate from the class results
          page after confirming gradebooks are still submitted or locked.
        </div>
      ) : null}

      {!detail?.term ? (
        <p className="text-sm text-muted-foreground">
          No computed term result for this student. Recalculate from the class
          dashboard after gradebooks are submitted.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Average"
              value={
                detail.term.average_percentage == null
                  ? "—"
                  : `${detail.term.average_percentage}%`
              }
            />
            <Stat
              label="Position"
              value={String(detail.term.overall_position ?? "—")}
            />
            <Stat
              label="Grade"
              value={detail.term.grade_code ?? "—"}
            />
            <Stat
              label="Promotion recommendation"
              value={detail.term.promotion_outcome}
            />
          </section>
          {detail.term.promotion_reason ? (
            <p className="text-sm text-muted-foreground">
              Recommendation only — does not change enrolment.{" "}
              {detail.term.promotion_reason}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Promotion outcome is a recommendation only and does not change
              enrolment or class placement.
            </p>
          )}

          {detail.term.remark ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Remark: </span>
              {detail.term.remark}
            </p>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Subjects</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">%</th>
                    <th className="px-3 py-2">Grade</th>
                    <th className="px-3 py-2">Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.subjects.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2">{s.subject_name}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {s.weighted_percentage ?? "—"}
                      </td>
                      <td className="px-3 py-2">{s.grade_code ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {s.subject_position ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Exam components</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Marks</th>
                    <th className="px-3 py-2">%</th>
                    <th className="px-3 py-2">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.exams.map((e) => (
                    <tr key={`${e.exam_id}-${e.subject_name}`} className="border-t">
                      <td className="px-3 py-2">{e.subject_name}</td>
                      <td className="px-3 py-2">{e.entry_status}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {e.marks_obtained == null
                          ? "—"
                          : `${e.marks_obtained} / ${e.max_marks}`}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {e.percentage ?? "—"}
                      </td>
                      <td className="px-3 py-2">{e.grade_code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
