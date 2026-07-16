import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from "@/features/attendance/schemas";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const STATUS_TONE: Record<AttendanceStatus, StatusTone> = {
  present: "success",
  absent: "danger",
  late: "warning",
  excused: "info",
};

export function AttendanceStatusBadge({
  status,
}: {
  status: AttendanceStatus;
}) {
  return (
    <StatusBadge tone={STATUS_TONE[status]}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

export function attendanceStatusTone(status: AttendanceStatus): StatusTone {
  return STATUS_TONE[status];
}
