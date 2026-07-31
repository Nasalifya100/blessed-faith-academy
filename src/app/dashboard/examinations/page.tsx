import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageExamSetup,
  canOpenExaminations,
} from "@/features/examinations/permissions";
import {
  getExaminationCommandCentre,
  listExamPeriods,
} from "@/features/examinations/queries";
import { ExaminationCommandCentrePanel } from "@/features/examinations/components/examination-command-centre";
import { ArchiveClosedButton } from "@/features/examinations/components/exam-setup-forms";
import { EXAM_PERIOD_STATUS_LABELS } from "@/features/examinations/schemas";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ExaminationsHomePage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenExaminations(current.profile.role)) {
    redirect("/dashboard");
  }

  const canManage = canManageExamSetup(current.profile.role);
  const [centre, periods] = await Promise.all([
    getExaminationCommandCentre(),
    listExamPeriods(),
  ]);

  const visiblePeriods = periods.filter((p) => p.status !== "ARCHIVED");
  const archivedCount = periods.length - visiblePeriods.length;

  return (
    <PageShell>
      <BackLink href="/dashboard">Dashboard</BackLink>
      <PageHeader
        title="Examinations"
        description="Command Centre for setup, marks, results, and report cards — guidance summaries never replace server checks."
      />

      {centre ? <ExaminationCommandCentrePanel centre={centre} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Exam periods</h2>
          {archivedCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {archivedCount} archived period
              {archivedCount === 1 ? "" : "s"} hidden from this list
            </p>
          ) : null}
        </div>
        {visiblePeriods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active exam periods yet.
            {canManage
              ? " Create one to start scheduling examinations."
              : " An administrator will set these up."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {visiblePeriods.map((period) => (
              <li
                key={period.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/dashboard/examinations/periods/${period.id}`}
                    className="font-medium hover:underline"
                  >
                    {period.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {period.academic_year_name}
                    {period.term_name ? ` · ${period.term_name}` : ""}
                    {" · "}
                    {EXAM_PERIOD_STATUS_LABELS[period.status]}
                    {" · "}
                    {period.exam_count ?? 0} exams
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/dashboard/examinations/periods/${period.id}`}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-11 shrink-0",
                    )}
                  >
                    Setup
                  </Link>
                  <Link
                    href={`/dashboard/examinations/periods/${period.id}/schedule`}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-11 shrink-0",
                    )}
                  >
                    Schedule
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="space-y-2 border-t pt-6">
          <h2 className="text-base font-semibold">Bulk actions</h2>
          <p className="text-sm text-muted-foreground">
            Archive closed periods only after marks and report cards for that
            sitting are finished.
          </p>
          <ArchiveClosedButton />
        </section>
      ) : null}
    </PageShell>
  );
}
