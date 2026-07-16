"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { saveClassAttendanceAction } from "@/features/attendance/actions";
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from "@/features/attendance/schemas";
import type { AttendanceRosterStudent } from "@/features/attendance/queries";
import { AttendanceStatusBadge } from "@/features/attendance/components/attendance-status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { fixedFormFooterClass } from "@/components/ui/admin-chrome";
import { cn } from "@/lib/utils";

interface AttendanceRegisterFormProps {
  classId: string;
  attendanceDate: string;
  students: AttendanceRosterStudent[];
}

type MarkState = Record<
  string,
  { status: AttendanceStatus; notes: string }
>;

function buildInitialMarks(students: AttendanceRosterStudent[]): MarkState {
  return Object.fromEntries(
    students.map((student) => [
      student.studentId,
      { status: student.status, notes: student.notes },
    ]),
  );
}

const STATUS_BUTTON_CLASS: Record<
  AttendanceStatus,
  { idle: string; selected: string }
> = {
  present: {
    idle: "border-border bg-background hover:bg-emerald-50 hover:border-emerald-300",
    selected:
      "border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-600 hover:text-white",
  },
  absent: {
    idle: "border-border bg-background hover:bg-red-50 hover:border-red-300",
    selected:
      "border-red-600 bg-red-600 text-white shadow-sm hover:bg-red-600 hover:text-white",
  },
  late: {
    idle: "border-border bg-background hover:bg-amber-50 hover:border-amber-300",
    selected:
      "border-amber-600 bg-amber-600 text-white shadow-sm hover:bg-amber-600 hover:text-white",
  },
  excused: {
    idle: "border-border bg-background hover:bg-sky-50 hover:border-sky-300",
    selected:
      "border-sky-600 bg-sky-600 text-white shadow-sm hover:bg-sky-600 hover:text-white",
  },
};

function StatusControls({
  studentName,
  value,
  onChange,
  disabled,
}: {
  studentName: string;
  value: AttendanceStatus;
  onChange: (status: AttendanceStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Attendance status for ${studentName}`}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {ATTENDANCE_STATUSES.map((status) => {
        const selected = value === status;
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(status)}
            className={cn(
              "min-h-11 rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? STATUS_BUTTON_CLASS[status].selected
                : STATUS_BUTTON_CLASS[status].idle,
            )}
          >
            <span className="sr-only">
              {selected ? "Selected: " : "Mark "}
            </span>
            {ATTENDANCE_STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}

export function AttendanceRegisterForm({
  classId,
  attendanceDate,
  students,
}: AttendanceRegisterFormProps) {
  const router = useRouter();
  const [marks, setMarks] = useState<MarkState>(() =>
    buildInitialMarks(students),
  );
  const [baseline, setBaseline] = useState<MarkState>(() =>
    buildInitialMarks(students),
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const values = Object.values(marks);
    return {
      present: values.filter((m) => m.status === "present").length,
      absent: values.filter((m) => m.status === "absent").length,
      late: values.filter((m) => m.status === "late").length,
      excused: values.filter((m) => m.status === "excused").length,
      total: values.length,
    };
  }, [marks]);

  const isDirty = useMemo(() => {
    return students.some((student) => {
      const current = marks[student.studentId];
      const base = baseline[student.studentId];
      if (!current || !base) return true;
      return current.status !== base.status || current.notes !== base.notes;
    });
  }, [baseline, marks, students]);

  const alreadySavedCount = students.filter((s) => s.hasExistingMark).length;
  const isFullySaved = alreadySavedCount === students.length && students.length > 0;

  function setStudentStatus(studentId: string, status: AttendanceStatus) {
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        status,
        notes: prev[studentId]?.notes ?? "",
      },
    }));
    setMessage(null);
  }

  function setStudentNotes(studentId: string, notes: string) {
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        status: prev[studentId]?.status ?? "present",
        notes,
      },
    }));
    setMessage(null);
  }

  function setAllPresent() {
    setMarks((prev) => {
      const next: MarkState = {};
      for (const [id, mark] of Object.entries(prev)) {
        next[id] = { ...mark, status: "present" };
      }
      return next;
    });
    setMessage(null);
  }

  function clearUnsaved() {
    setMarks(baseline);
    setError(null);
    setMessage(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveClassAttendanceAction({
        classId,
        attendanceDate,
        marks: students.map((student) => ({
          studentId: student.studentId,
          status: marks[student.studentId]?.status ?? "present",
          notes: marks[student.studentId]?.notes ?? "",
        })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      const nextBaseline = { ...marks };
      setBaseline(nextBaseline);
      setSavedAt(
        new Date().toLocaleTimeString("en-ZM", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setMessage(
        `Saved ${result.savedCount} mark${result.savedCount === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  }

  if (students.length === 0) {
    return (
      <EmptyState
        title="No enrolled students"
        description="This class has no enrolled students yet. Add students before taking the register."
        size="sm"
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-24">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <AttendanceStatusBadge status="present" />
          <span className="tabular-nums text-muted-foreground">
            {counts.present}
          </span>
          <AttendanceStatusBadge status="absent" />
          <span className="tabular-nums text-muted-foreground">
            {counts.absent}
          </span>
          <AttendanceStatusBadge status="late" />
          <span className="tabular-nums text-muted-foreground">
            {counts.late}
          </span>
          <AttendanceStatusBadge status="excused" />
          <span className="tabular-nums text-muted-foreground">
            {counts.excused}
          </span>
          <span className="text-muted-foreground">
            · {counts.total} on roll
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={setAllPresent}
            disabled={isPending}
          >
            Mark all present
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearUnsaved}
            disabled={isPending || !isDirty}
          >
            Clear unsaved
          </Button>
        </div>
      </div>

      {message ? (
        <div
          className="flex flex-wrap items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">{message}</p>
            {savedAt ? (
              <p className="text-xs opacity-90">Saved at {savedAt}</p>
            ) : null}
            <p className="text-xs opacity-90">
              Changing marks and saving again updates the register. Corrections
              are audited for each student.
            </p>
          </div>
        </div>
      ) : null}

      {isFullySaved && !message && !isDirty ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <StatusBadge tone="success">Register saved</StatusBadge>
          <span className="text-muted-foreground">
            {alreadySavedCount} of {students.length} marks on file. Edit any
            student and save to correct.
          </span>
        </div>
      ) : null}

      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-xl border shadow-sm md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const mark = marks[student.studentId];
              return (
                <tr
                  key={student.studentId}
                  className="border-b last:border-0 align-top"
                >
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <p className="font-medium">{student.fullName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {student.admissionNumber}
                      </p>
                      <AttendanceStatusBadge
                        status={mark?.status ?? student.status}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 min-w-[18rem]">
                    <StatusControls
                      studentName={student.fullName}
                      value={mark?.status ?? "present"}
                      onChange={(status) =>
                        setStudentStatus(student.studentId, status)
                      }
                      disabled={isPending}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      className="w-full min-h-11 rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                      value={mark?.notes ?? ""}
                      onChange={(event) =>
                        setStudentNotes(student.studentId, event.target.value)
                      }
                      placeholder="Optional notes"
                      aria-label={`Notes for ${student.fullName}`}
                      disabled={isPending}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <ul className="space-y-3 md:hidden">
        {students.map((student) => {
          const mark = marks[student.studentId];
          return (
            <li
              key={student.studentId}
              className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium leading-snug">{student.fullName}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {student.admissionNumber}
                  </p>
                </div>
                <AttendanceStatusBadge
                  status={mark?.status ?? student.status}
                />
              </div>
              <StatusControls
                studentName={student.fullName}
                value={mark?.status ?? "present"}
                onChange={(status) =>
                  setStudentStatus(student.studentId, status)
                }
                disabled={isPending}
              />
              <input
                type="text"
                className="w-full min-h-11 rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                value={mark?.notes ?? ""}
                onChange={(event) =>
                  setStudentNotes(student.studentId, event.target.value)
                }
                placeholder="Optional notes"
                aria-label={`Notes for ${student.fullName}`}
                disabled={isPending}
              />
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className={fixedFormFooterClass}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {isDirty ? (
              <StatusBadge tone="warning" label="Unsaved changes">
                Unsaved changes
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral" label="All changes saved">
                No unsaved changes
              </StatusBadge>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            className="min-h-11 min-w-[10rem]"
            disabled={isPending || (!isDirty && isFullySaved)}
          >
            {isPending ? "Saving…" : "Save attendance"}
          </Button>
        </div>
      </div>
    </form>
  );
}
