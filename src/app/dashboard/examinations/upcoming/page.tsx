import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenExaminations } from "@/features/examinations/permissions";
import { listUpcomingExamsForCurrentUser } from "@/features/examinations/queries";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-ZM", {
    day: "numeric",
    month: "short",
  });
}

export default async function UpcomingExamsPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenExaminations(current.profile.role)) {
    redirect("/dashboard");
  }

  const upcoming = await listUpcomingExamsForCurrentUser();

  return (
    <PageShell>
      <BackLink href="/dashboard/examinations">Examinations</BackLink>
      <PageHeader
        title="Upcoming exams"
        description="Your invigilation timetable. Scores are not entered here."
      />

      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No upcoming exams assigned to you.
        </p>
      ) : (
        <ul className="space-y-3">
          {upcoming.map((exam) => (
            <li
              key={`${exam.exam_id}-${exam.exam_date}-${exam.start_time}`}
              className="rounded-md border p-4"
            >
              <p className="text-lg font-semibold">
                {exam.grade_name} {exam.subject_name}
              </p>
              <p className="text-sm text-muted-foreground">
                Exam reference {exam.exam_reference}
              </p>
              <p className="mt-1 text-base">
                {formatDay(exam.exam_date)} · {exam.start_time}
                {exam.room_name ? ` · ${exam.room_name}` : ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {exam.period_name} · {exam.role_label}
              </p>
              {exam.instructions ? (
                <p className="mt-2 text-sm">{exam.instructions}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
