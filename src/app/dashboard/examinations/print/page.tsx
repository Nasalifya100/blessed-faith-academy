import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenExaminations } from "@/features/examinations/permissions";
import {
  getSchoolBrandForPrint,
  listExamPeriods,
  listExamsForPeriod,
} from "@/features/examinations/queries";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { PrintTimetableButton } from "@/features/examinations/components/print-timetable-button";

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-ZM", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function PrintTimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; grade?: string; room?: string }>;
}) {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenExaminations(current.profile.role)) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const periods = await listExamPeriods();
  const periodId = sp.period || periods[0]?.id || "";
  const period = periods.find((p) => p.id === periodId) ?? null;
  const exams = periodId ? await listExamsForPeriod(periodId) : [];
  const brand = await getSchoolBrandForPrint();

  let filtered = exams.filter((e) => e.schedule);
  if (sp.grade) {
    filtered = filtered.filter((e) => e.grade_level_id === sp.grade);
  }
  if (sp.room) {
    filtered = filtered.filter((e) => e.schedule?.room_id === sp.room);
  }
  filtered.sort((a, b) =>
    `${a.schedule!.exam_date}${a.schedule!.start_time}`.localeCompare(
      `${b.schedule!.exam_date}${b.schedule!.start_time}`,
    ),
  );

  const grades = [...new Map(exams.map((e) => [e.grade_level_id, e.grade_name]))];
  const rooms = [
    ...new Map(
      exams
        .filter((e) => e.schedule?.room_id)
        .map((e) => [e.schedule!.room_id!, e.schedule!.room_name ?? "Room"]),
    ),
  ];

  return (
    <PageShell>
      <div className="print:hidden">
        <BackLink href="/dashboard/examinations">Examinations</BackLink>
        <PageHeader
          title="Print exam timetable"
          description="A4-friendly school timetable. Choose filters, then print."
        />
        <form
          method="get"
          className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <label className="space-y-1 text-sm">
            <span className="font-medium">Exam period</span>
            <select
              name="period"
              defaultValue={periodId}
              className="flex h-11 w-full min-w-[12rem] rounded-md border bg-background px-3 text-sm"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Grade</span>
            <select
              name="grade"
              defaultValue={sp.grade ?? ""}
              className="flex h-11 w-full min-w-[10rem] rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Entire school</option>
              {grades.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Room</span>
            <select
              name="room"
              defaultValue={sp.room ?? ""}
              className="flex h-11 w-full min-w-[10rem] rounded-md border bg-background px-3 text-sm"
            >
              <option value="">All rooms</option>
              {rooms.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" className="h-11">
            Apply
          </Button>
          <PrintTimetableButton />
        </form>
      </div>

      <article className="space-y-6 bg-white text-black print:border-0">
        <header className="space-y-1 border-b pb-4 text-center">
          <p className="text-xl font-semibold">
            {brand?.name ?? "Blessed Faith Academy"}
          </p>
          {brand?.motto ? (
            <p className="text-sm italic text-neutral-700">{brand.motto}</p>
          ) : null}
          <p className="text-sm text-neutral-700">
            {[brand?.address, brand?.phone].filter(Boolean).join(" · ")}
          </p>
          <p className="pt-2 text-lg font-medium">
            Exam timetable
            {period ? ` — ${period.name}` : ""}
          </p>
        </header>

        {filtered.length === 0 ? (
          <p className="text-sm">No scheduled exams for this selection.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-2 pr-2 font-semibold">Reference</th>
                <th className="py-2 pr-2 font-semibold">Date</th>
                <th className="py-2 pr-2 font-semibold">Time</th>
                <th className="py-2 pr-2 font-semibold">Grade / Subject</th>
                <th className="py-2 pr-2 font-semibold">Room</th>
                <th className="py-2 font-semibold">Invigilator</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exam) => (
                <tr key={exam.id} className="border-b border-neutral-300 align-top">
                  <td className="py-2 pr-2 whitespace-nowrap font-mono text-xs">
                    {exam.exam_reference}
                  </td>
                  <td className="py-2 pr-2">{formatDay(exam.schedule!.exam_date)}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {exam.schedule!.start_time}–{exam.schedule!.end_time}
                  </td>
                  <td className="py-2 pr-2">
                    <div>
                      {exam.grade_name} {exam.subject_name}
                    </div>
                    {exam.instructions ? (
                      <div className="text-xs text-neutral-700">
                        {exam.instructions}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2">{exam.schedule!.room_name ?? "—"}</td>
                  <td className="py-2">
                    {exam.schedule!.primary_invigilator_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </PageShell>
  );
}
