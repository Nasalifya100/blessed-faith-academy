import type { ReportCardRenderPayload } from "@/features/report-cards/types";
import { cn } from "@/lib/utils";

function fmtPct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value}%`;
}

export function ReportCardDocument(props: {
  payload: ReportCardRenderPayload;
  statusLabel: string;
  showDraftWatermark?: boolean;
  className?: string;
}) {
  const { payload, statusLabel, showDraftWatermark } = props;
  const settings = payload.settings;
  const schoolInitials = payload.school.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const studentName = [
    payload.student.last_name,
    [payload.student.first_name, payload.student.middle_name]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <article
      className={cn(
        "relative mx-auto max-w-[210mm] space-y-5 bg-white p-6 text-black print:max-w-none print:p-0",
        props.className,
      )}
    >
      {showDraftWatermark ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        >
          <span className="rotate-[-28deg] text-6xl font-bold tracking-widest text-neutral-300/70 uppercase">
            Draft
          </span>
        </div>
      ) : null}

      <header className="relative space-y-3 border-b border-black pb-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center overflow-hidden rounded-md border border-black">
          {settings.show_school_logo && payload.school.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={payload.school.logo_url}
              alt=""
              className="size-full object-contain p-1"
            />
          ) : (
            <span className="text-lg font-bold">{schoolInitials}</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {payload.school.name}
          </h1>
          {payload.school.motto ? (
            <p className="text-sm italic text-neutral-700">{payload.school.motto}</p>
          ) : null}
          <p className="mt-2 text-lg font-medium">{settings.title}</p>
          <p className="text-sm text-neutral-700">
            {payload.academic_year.name} · {payload.term.name}
          </p>
          <p className="text-xs uppercase tracking-wide text-neutral-600">
            Status: {statusLabel}
          </p>
        </div>
      </header>

      <section className="relative grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <span className="text-neutral-600">Student: </span>
          <strong>{studentName}</strong>
        </p>
        {settings.show_admission_number ? (
          <p>
            <span className="text-neutral-600">Admission No: </span>
            {payload.student.admission_number ?? "—"}
          </p>
        ) : null}
        <p>
          <span className="text-neutral-600">Class: </span>
          {payload.class.grade_name} — {payload.class.name}
        </p>
        {settings.show_generated_timestamp ? (
          <p>
            <span className="text-neutral-600">Generated: </span>
            {new Date(payload.generated_at).toLocaleString("en-ZM")}
          </p>
        ) : null}
      </section>

      <section className="relative space-y-2">
        <h2 className="text-base font-semibold">Academic results</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2 font-medium">Subject</th>
              <th className="py-1 pr-2 font-medium">%</th>
              <th className="py-1 pr-2 font-medium">Grade</th>
              {settings.show_grade_points ? (
                <th className="py-1 pr-2 font-medium">GP</th>
              ) : null}
              {settings.show_subject_position ? (
                <th className="py-1 pr-2 font-medium">Pos</th>
              ) : null}
              <th className="py-1 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {payload.subjects.map((s) => {
              const special = s.entry_statuses.filter((st) =>
                ["ABSENT", "EXEMPT", "NOT_ASSESSED"].includes(st),
              );
              return (
                <tr key={s.subject_id} className="border-b border-neutral-300">
                  <td className="py-1 pr-2">{s.subject_name}</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {fmtPct(s.weighted_percentage)}
                  </td>
                  <td className="py-1 pr-2">{s.grade_code ?? "—"}</td>
                  {settings.show_grade_points ? (
                    <td className="py-1 pr-2 tabular-nums">
                      {s.grade_point ?? "—"}
                    </td>
                  ) : null}
                  {settings.show_subject_position ? (
                    <td className="py-1 pr-2 tabular-nums">
                      {s.subject_position ?? "—"}
                    </td>
                  ) : null}
                  <td className="py-1 text-neutral-700">
                    {special.length
                      ? special.join(", ")
                      : (s.remark ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="relative grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1 rounded-md border border-black p-3">
          <h2 className="font-semibold">Summary</h2>
          <p>Average: {fmtPct(payload.summary.average_percentage)}</p>
          <p>
            Overall grade: {payload.summary.grade_code ?? "—"}
            {payload.summary.grade_label
              ? ` · ${payload.summary.grade_label}`
              : ""}
          </p>
          {settings.show_grade_points ? (
            <p>Grade point: {payload.summary.grade_point ?? "—"}</p>
          ) : null}
          {settings.show_class_position ? (
            payload.summary.ranking_enabled ? (
              <p>
                Class position: {payload.summary.overall_position ?? "—"}
                {payload.summary.tied_count > 1
                  ? ` (tied ${payload.summary.tied_count})`
                  : ""}
              </p>
            ) : (
              <p>{settings.ranking_disabled_message}</p>
            )
          ) : null}
          <p>
            Passed / failed: {payload.summary.passed_subject_count} /{" "}
            {payload.summary.failed_subject_count}
          </p>
          {settings.show_promotion_recommendation ? (
            <p>
              Promotion recommendation:{" "}
              <strong>{payload.summary.promotion_outcome}</strong>
              {payload.summary.promotion_reason
                ? ` — ${payload.summary.promotion_reason}`
                : ""}
            </p>
          ) : null}
        </div>

        {settings.show_attendance ? (
          <div className="space-y-1 rounded-md border border-black p-3">
            <h2 className="font-semibold">Attendance</h2>
            {payload.attendance.available ? (
              <>
                <p>Present: {payload.attendance.present}</p>
                <p>Absent: {payload.attendance.absent}</p>
                <p>Late: {payload.attendance.late}</p>
                <p>Excused: {payload.attendance.excused}</p>
                <p>Sessions recorded: {payload.attendance.total}</p>
                <p>
                  Attendance rate: {fmtPct(payload.attendance.percentage)}
                </p>
              </>
            ) : (
              <p>Not available{payload.attendance.note ? ` — ${payload.attendance.note}` : ""}</p>
            )}
          </div>
        ) : null}
      </section>

      {(settings.show_teacher_remark || settings.show_headteacher_remark) && (
        <section className="relative space-y-3 text-sm">
          <h2 className="font-semibold">Remarks</h2>
          {settings.show_teacher_remark ? (
            <p>
              <span className="text-neutral-600">Class teacher: </span>
              {payload.remarks.teacher ?? "—"}
            </p>
          ) : null}
          {settings.show_headteacher_remark ? (
            <p>
              <span className="text-neutral-600">Head teacher: </span>
              {payload.remarks.headteacher ?? "—"}
            </p>
          ) : null}
        </section>
      )}

      {settings.show_grading_key && payload.grading_key.length > 0 ? (
        <section className="relative space-y-2 text-xs">
          <h2 className="text-sm font-semibold">Grading key</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {payload.grading_key.map((g) => (
              <span key={g.grade_code}>
                {g.grade_code} ({g.minimum_score}–{g.maximum_score}){" "}
                {g.grade_label}
                {g.is_pass ? "" : " · Fail"}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="relative mt-8 grid gap-8 text-sm sm:grid-cols-2">
        <div className="space-y-8">
          <div>
            <div className="mb-8 border-b border-black" />
            <p>
              {payload.signatories.class_teacher_name ?? "Class Teacher"}
            </p>
            <p className="text-xs text-neutral-600">Class Teacher</p>
          </div>
        </div>
        <div className="space-y-8">
          <div>
            <div className="mb-8 border-b border-black" />
            <p>{payload.signatories.headteacher_title}</p>
            <p className="text-xs text-neutral-600">Signature</p>
          </div>
        </div>
        {settings.footer_text ? (
          <p className="sm:col-span-2 text-xs text-neutral-600">
            {settings.footer_text}
          </p>
        ) : null}
        <p className="sm:col-span-2 text-[10px] text-neutral-500">
          Official calculated record · Results engine {payload.engine_version} ·
          Template {payload.template_version}
        </p>
      </footer>
    </article>
  );
}
