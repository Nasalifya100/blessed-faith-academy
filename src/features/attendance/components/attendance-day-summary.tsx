import type { ClassAttendanceRegister } from "@/features/attendance/queries";
import { AttendanceStatusBadge } from "@/features/attendance/components/attendance-status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { CheckCircle2, Clock3, UserX, Users } from "lucide-react";

interface AttendanceDaySummaryProps {
  register: ClassAttendanceRegister;
}

export function AttendanceDaySummary({ register }: AttendanceDaySummaryProps) {
  const { summary, students, attendanceDate } = register;
  const savedCount = students.filter((s) => s.hasExistingMark).length;
  const isSaved = savedCount > 0;
  const isComplete = savedCount === summary.total && summary.total > 0;
  const pending = Math.max(summary.total - savedCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Day summary · {attendanceDate}</p>
        {isComplete ? (
          <StatusBadge tone="success">Register completed</StatusBadge>
        ) : isSaved ? (
          <StatusBadge tone="warning">
            {savedCount} of {summary.total} saved
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not saved yet</StatusBadge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Present"
          value={String(summary.present)}
          hint={`${summary.total} on roll`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          title="Absent"
          value={String(summary.absent)}
          icon={UserX}
          tone="danger"
        />
        <StatCard
          title="Late"
          value={String(summary.late)}
          icon={Clock3}
          tone="warning"
        />
        <StatCard
          title={isComplete ? "Completed" : "Pending marks"}
          value={isComplete ? String(savedCount) : String(pending)}
          hint={
            isComplete
              ? "All students have a saved mark"
              : isSaved
                ? "Students still without a saved mark"
                : "Save the register to lock in today's marks"
          }
          icon={Users}
          tone={isComplete ? "success" : "info"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <AttendanceStatusBadge status="present" />
        <span className="self-center text-xs text-muted-foreground tabular-nums">
          {summary.present}
        </span>
        <AttendanceStatusBadge status="absent" />
        <span className="self-center text-xs text-muted-foreground tabular-nums">
          {summary.absent}
        </span>
        <AttendanceStatusBadge status="late" />
        <span className="self-center text-xs text-muted-foreground tabular-nums">
          {summary.late}
        </span>
        <AttendanceStatusBadge status="excused" />
        <span className="self-center text-xs text-muted-foreground tabular-nums">
          {summary.excused}
        </span>
      </div>

      {!isSaved && summary.total > 0 ? (
        <p className="text-xs text-muted-foreground">
          Counts reflect form defaults (everyone present) until you save.
        </p>
      ) : null}
    </div>
  );
}
