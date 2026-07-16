import type { StudentAttendanceHistory } from "@/features/attendance/queries";
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from "@/features/attendance/schemas";
import { AttendanceStatusBadge } from "@/features/attendance/components/attendance-status-badge";
import { SectionHeading } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Percent,
  UserX,
} from "lucide-react";

interface StudentAttendanceHistoryProps {
  history: StudentAttendanceHistory;
}

function formatDay(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZM", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CorrectionReason({
  oldNotes,
  newNotes,
}: {
  oldNotes: string;
  newNotes: string;
}) {
  const oldTrim = oldNotes.trim();
  const newTrim = newNotes.trim();
  if (!oldTrim && !newTrim) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (oldTrim === newTrim) {
    return (
      <span className="text-muted-foreground">{newTrim || "—"}</span>
    );
  }
  return (
    <span className="text-sm">
      {oldTrim ? (
        <>
          <span className="text-muted-foreground line-through">{oldTrim}</span>
          {" → "}
        </>
      ) : null}
      {newTrim || "—"}
    </span>
  );
}

export function StudentAttendanceHistoryView({
  history,
}: StudentAttendanceHistoryProps) {
  const { summary, days, corrections, academicYearName } = history;

  if (summary.total === 0) {
    return (
      <EmptyState
        title="No attendance history"
        description={
          <>
            No attendance recorded yet
            {academicYearName ? ` for ${academicYearName}` : ""}. Marks appear
            here after a class register is saved.
          </>
        }
        size="sm"
        icon={
          <CalendarDays
            className="size-6 text-muted-foreground"
            aria-hidden
          />
        }
      />
    );
  }

  const rate =
    summary.total > 0
      ? Math.round(((summary.present + summary.late) / summary.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Present %"
          value={`${rate}%`}
          hint="Present + late"
          icon={Percent}
          tone="success"
        />
        <StatCard
          title="Present"
          value={String(summary.present)}
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
          title="Excused"
          value={String(summary.excused)}
          hint={
            academicYearName
              ? `${summary.total} day${summary.total === 1 ? "" : "s"} · ${academicYearName}`
              : `${summary.total} day${summary.total === 1 ? "" : "s"}`
          }
        />
      </div>

      <section className="space-y-3">
        <SectionHeading
          title="Daily history"
          description="Most recent attendance marks for this student."
        />

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-xl border shadow-sm md:block">
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
                    <AttendanceStatusBadge status={day.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {day.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <ul className="space-y-3 md:hidden">
          {days.map((day) => (
            <li
              key={day.id}
              className="space-y-2 rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{formatDay(day.date)}</p>
                  <p className="text-sm text-muted-foreground">
                    {day.className}
                  </p>
                </div>
                <AttendanceStatusBadge status={day.status} />
              </div>
              {day.notes ? (
                <p className="text-sm text-muted-foreground">{day.notes}</p>
              ) : null}
            </li>
          ))}
        </ul>

        {days.length < summary.total ? (
          <p className="text-xs text-muted-foreground">
            Showing the {days.length} most recent days ({summary.total} total
            this year).
          </p>
        ) : null}
      </section>

      {corrections.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading
            title="Attendance corrections"
            description="Audit trail of status changes for this student."
          />

          <div className="hidden overflow-hidden rounded-xl border shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Previous</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Reason / notes</TableHead>
                  <TableHead>Changed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corrections.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatWhen(row.changedAt)}
                    </TableCell>
                    <TableCell>{formatDay(row.date)}</TableCell>
                    <TableCell>
                      <AttendanceStatusBadge
                        status={row.oldStatus as AttendanceStatus}
                      />
                    </TableCell>
                    <TableCell>
                      <AttendanceStatusBadge
                        status={row.newStatus as AttendanceStatus}
                      />
                    </TableCell>
                    <TableCell>
                      <CorrectionReason
                        oldNotes={row.oldNotes}
                        newNotes={row.newNotes}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.changedByName ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 md:hidden">
            {corrections.map((row) => (
              <li
                key={row.id}
                className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {formatWhen(row.changedAt)}
                  </p>
                  <StatusBadge tone="info">Correction</StatusBadge>
                </div>
                <p className="text-sm font-medium">{formatDay(row.date)}</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <AttendanceStatusBadge status={row.oldStatus} />
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                  <span className="sr-only">
                    changed from {ATTENDANCE_STATUS_LABELS[row.oldStatus]} to{" "}
                    {ATTENDANCE_STATUS_LABELS[row.newStatus]}
                  </span>
                  <AttendanceStatusBadge status={row.newStatus} />
                </div>
                <div className="space-y-1 text-sm">
                  <p className="text-muted-foreground">Reason / notes</p>
                  <CorrectionReason
                    oldNotes={row.oldNotes}
                    newNotes={row.newNotes}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Changed by: {row.changedByName ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
