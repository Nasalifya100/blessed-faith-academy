import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageExamSetup,
  canOpenExaminations,
} from "@/features/examinations/permissions";
import {
  getExamPeriod,
  listExamRooms,
  listExamStaffCandidates,
  listExamsForPeriod,
} from "@/features/examinations/queries";
import {
  BulkScheduleTools,
  ScheduleExamForm,
} from "@/features/examinations/components/exam-setup-forms";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-ZM", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default async function ExamSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenExaminations(current.profile.role)) {
    redirect("/dashboard");
  }

  const period = await getExamPeriod(id);
  if (!period) notFound();

  const canManage = canManageExamSetup(current.profile.role);
  const exams = await listExamsForPeriod(id);
  const rooms = await listExamRooms(true);
  const staff = canManage ? await listExamStaffCandidates() : [];

  const scheduled = exams
    .filter((e) => e.schedule)
    .slice()
    .sort((a, b) =>
      `${a.schedule!.exam_date}${a.schedule!.start_time}`.localeCompare(
        `${b.schedule!.exam_date}${b.schedule!.start_time}`,
      ),
    );

  const byDate = new Map<string, typeof scheduled>();
  for (const exam of scheduled) {
    const key = exam.schedule!.exam_date;
    const list = byDate.get(key) ?? [];
    list.push(exam);
    byDate.set(key, list);
  }

  return (
    <PageShell>
      <BackLink href={`/dashboard/examinations/periods/${id}`}>
        {period.name}
      </BackLink>
      <PageHeader
        title="Exam schedule"
        description="Set dates, rooms and invigilators. Teachers see upcoming exams on their timetable."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Timetable</h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exams scheduled yet.
          </p>
        ) : (
          <div className="space-y-4">
            {[...byDate.entries()].map(([date, dayExams]) => (
              <div key={date} className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {formatDay(date)}
                </h3>
                <ul className="divide-y rounded-md border">
                  {dayExams.map((exam) => (
                    <li key={exam.id} className="space-y-1 p-4">
                      <p className="font-medium">
                        {exam.grade_name} {exam.subject_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {exam.schedule!.start_time}–{exam.schedule!.end_time}
                        {exam.schedule!.room_name
                          ? ` · ${exam.schedule!.room_name}`
                          : ""}
                        {exam.schedule!.primary_invigilator_name
                          ? ` · ${exam.schedule!.primary_invigilator_name}`
                          : ""}
                      </p>
                      {exam.instructions ? (
                        <p className="text-sm">{exam.instructions}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 overflow-x-auto border-t pt-6">
        <h2 className="text-lg font-semibold">Schedule table</h2>
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2 font-medium">Reference</th>
              <th className="p-2 font-medium">Grade / Subject</th>
              <th className="p-2 font-medium">Date</th>
              <th className="p-2 font-medium">Time</th>
              <th className="p-2 font-medium">Room</th>
              <th className="p-2 font-medium">Invigilator</th>
            </tr>
          </thead>
          <tbody>
            {exams.map((exam) => (
              <tr key={exam.id} className="border-b align-top">
                <td className="p-2 whitespace-nowrap font-mono text-xs">
                  {exam.exam_reference}
                </td>
                <td className="p-2">
                  {exam.grade_name} {exam.subject_name}
                </td>
                <td className="p-2">{exam.schedule?.exam_date ?? "—"}</td>
                <td className="p-2">
                  {exam.schedule
                    ? `${exam.schedule.start_time}–${exam.schedule.end_time}`
                    : "—"}
                </td>
                <td className="p-2">{exam.schedule?.room_name ?? "—"}</td>
                <td className="p-2">
                  {exam.schedule?.primary_invigilator_name ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canManage ? (
        <>
          <section className="space-y-6 border-t pt-6">
            <h2 className="text-lg font-semibold">Assign schedule</h2>
            {exams.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add exams to this period first.
              </p>
            ) : (
              exams.map((exam) => (
                <div key={exam.id} className="space-y-3 rounded-md border p-4">
                  <div>
                    <p className="font-medium">
                      {exam.grade_name} {exam.subject_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Exam reference {exam.exam_reference} ·{" "}
                      {exam.assessment_type_name} · {exam.max_marks} marks
                    </p>
                  </div>
                  <ScheduleExamForm
                    examId={exam.id}
                    rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
                    staff={staff}
                    defaults={
                      exam.schedule
                        ? {
                            exam_date: exam.schedule.exam_date,
                            start_time: exam.schedule.start_time,
                            end_time: exam.schedule.end_time,
                            room_id: exam.schedule.room_id,
                            primary_invigilator_id:
                              exam.schedule.primary_invigilator_id,
                            assistant_invigilator_id:
                              exam.schedule.assistant_invigilator_id,
                            notes: exam.schedule.notes,
                          }
                        : undefined
                    }
                  />
                </div>
              ))
            )}
          </section>

          <section className="space-y-3 border-t pt-6">
            <h2 className="text-lg font-semibold">Bulk tools</h2>
            <BulkScheduleTools
              periodId={id}
              rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
            />
          </section>
        </>
      ) : null}
    </PageShell>
  );
}
