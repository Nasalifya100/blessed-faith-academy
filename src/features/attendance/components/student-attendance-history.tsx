import type { StudentAttendanceHistory } from "@/features/attendance/queries";
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from "@/features/attendance/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface StudentAttendanceHistoryProps {
  history: StudentAttendanceHistory;
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZM", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusVariant(
  status: AttendanceStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "absent") return "destructive";
  if (status === "present") return "secondary";
  return "outline";
}

export function StudentAttendanceHistoryView({
  history,
}: StudentAttendanceHistoryProps) {
  const { summary, days, academicYearName } = history;

  if (summary.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No attendance recorded yet
        {academicYearName ? ` for ${academicYearName}` : ""}. Marks appear here
        after a class register is saved.
      </p>
    );
  }

  const rate =
    summary.total > 0
      ? Math.round(
          ((summary.present + summary.late) / summary.total) * 100,
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{summary.present} present</Badge>
        <Badge variant="destructive">{summary.absent} absent</Badge>
        <Badge variant="outline">{summary.late} late</Badge>
        <Badge variant="outline">{summary.excused} excused</Badge>
        <span className="text-muted-foreground">
          {summary.total} day{summary.total === 1 ? "" : "s"}
          {academicYearName ? ` · ${academicYearName}` : ""} · {rate}% in school
          (present + late)
        </span>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.id}>
                <TableCell>{formatDay(day.date)}</TableCell>
                <TableCell>{day.className}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(day.status)}>
                    {ATTENDANCE_STATUS_LABELS[day.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {day.notes || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {days.length < summary.total ? (
        <p className="text-xs text-muted-foreground">
          Showing the {days.length} most recent days ({summary.total} total this
          year).
        </p>
      ) : null}
    </div>
  );
}
