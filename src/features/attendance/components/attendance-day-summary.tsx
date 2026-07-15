import type { ClassAttendanceRegister } from "@/features/attendance/queries";
import { Badge } from "@/components/ui/badge";

interface AttendanceDaySummaryProps {
  register: ClassAttendanceRegister;
}

export function AttendanceDaySummary({ register }: AttendanceDaySummaryProps) {
  const { summary, students, attendanceDate } = register;
  const savedCount = students.filter((s) => s.hasExistingMark).length;
  const isSaved = savedCount > 0;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Day summary · {attendanceDate}</p>
        <Badge variant={isSaved ? "secondary" : "outline"}>
          {isSaved
            ? `${savedCount} of ${summary.total} saved`
            : "Not saved yet"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{summary.present} present</Badge>
        <Badge variant="destructive">{summary.absent} absent</Badge>
        <Badge variant="outline">{summary.late} late</Badge>
        <Badge variant="outline">{summary.excused} excused</Badge>
        <span className="text-muted-foreground">
          {summary.total} on roll
        </span>
      </div>
      {!isSaved && summary.total > 0 ? (
        <p className="text-xs text-muted-foreground">
          Counts below reflect the form defaults (everyone present) until you
          save.
        </p>
      ) : null}
    </div>
  );
}
