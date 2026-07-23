import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageExamSetup,
  canOpenExaminations,
} from "@/features/examinations/permissions";
import { listExamPeriods } from "@/features/examinations/queries";
import {
  ArchiveClosedButton,
  PrintLink,
} from "@/features/examinations/components/exam-setup-forms";
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
  const periods = await listExamPeriods();

  return (
    <PageShell>
      <BackLink href="/dashboard">Dashboard</BackLink>
      <PageHeader
        title="Examinations"
        description="Prepare exam periods, schedules, rooms and invigilators. Marks entry comes later."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href="/dashboard/examinations/upcoming"
          className={cn(buttonVariants(), "h-11")}
        >
          Upcoming exams
        </Link>
        {canManage ? (
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
            <PrintLink
              href="/dashboard/examinations/print"
              label="Print timetables"
            />
          </>
        ) : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Exam periods</h2>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exam periods yet.
            {canManage
              ? " Create one to start scheduling examinations."
              : " An administrator will set these up."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {periods.map((period) => (
              <li key={period.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
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
                <Link
                  href={`/dashboard/examinations/periods/${period.id}/schedule`}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-11 shrink-0",
                  )}
                >
                  Exam schedule
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="space-y-2 border-t pt-6">
          <h2 className="text-base font-semibold">Bulk actions</h2>
          <ArchiveClosedButton />
        </section>
      ) : null}
    </PageShell>
  );
}
