import type { ClassAttendanceSummaryRow } from "@/features/reports/queries";
import { SectionHeading } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";

/** Visual trend from already-loaded class rates — no extra queries. */
export function AttendanceTrendPanel({
  rows,
}: {
  rows: ClassAttendanceSummaryRow[];
}) {
  const withMarks = rows.filter((row) => row.totalMarks > 0);

  if (withMarks.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="space-y-2 py-6">
          <SectionHeading
            title="Attendance by class"
            description="Rates appear here once registers are saved for the selected period."
          />
          <div
            className="flex h-32 items-end justify-center rounded-xl border border-dashed bg-muted/30 px-4"
            role="img"
            aria-label="Attendance trend placeholder — no data yet"
          >
            <p className="self-center text-sm text-muted-foreground">
              No attendance trend data for this period
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxRate = Math.max(...withMarks.map((r) => r.attendanceRate), 1);

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-4 py-6">
        <SectionHeading
          title="Attendance by class"
          description="Relative attendance rates from the loaded report (present + late)."
        />
        <div
          className="flex h-40 items-end gap-1.5 overflow-x-auto pb-1 sm:gap-2"
          role="img"
          aria-label="Bar chart of attendance rates by class"
        >
          {withMarks.map((row) => {
            const heightPct = Math.max(
              8,
              Math.round((row.attendanceRate / maxRate) * 100),
            );
            return (
              <div
                key={row.classId}
                className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-1"
              >
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {row.attendanceRate}%
                </span>
                <div
                  className="w-full max-w-10 rounded-t-md bg-sky-600/80 dark:bg-sky-500/70"
                  style={{ height: `${heightPct}%` }}
                  title={`${row.className}: ${row.attendanceRate}%`}
                />
                <span className="max-w-full truncate text-[10px] text-muted-foreground">
                  {row.className}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
