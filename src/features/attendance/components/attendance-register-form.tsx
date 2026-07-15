"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { saveClassAttendanceAction } from "@/features/attendance/actions";
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from "@/features/attendance/schemas";
import type { AttendanceRosterStudent } from "@/features/attendance/queries";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";

interface AttendanceRegisterFormProps {
  classId: string;
  attendanceDate: string;
  students: AttendanceRosterStudent[];
}

type MarkState = Record<
  string,
  { status: AttendanceStatus; notes: string }
>;

export function AttendanceRegisterForm({
  classId,
  attendanceDate,
  students,
}: AttendanceRegisterFormProps) {
  const router = useRouter();
  const [marks, setMarks] = useState<MarkState>(() =>
    Object.fromEntries(
      students.map((student) => [
        student.studentId,
        { status: student.status, notes: student.notes },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  function setAllPresent() {
    setMarks((prev) => {
      const next: MarkState = {};
      for (const [id, mark] of Object.entries(prev)) {
        next[id] = { ...mark, status: "present" };
      }
      return next;
    });
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
      setMessage(`Saved ${result.savedCount} mark${result.savedCount === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  if (students.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No enrolled students in this class yet.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {counts.present} present · {counts.absent} absent · {counts.late} late
          · {counts.excused} excused
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={setAllPresent}
        >
          Mark all present
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-3 py-2 font-medium">Admission #</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.studentId} className="border-b last:border-0">
                <td className="px-3 py-2">{student.fullName}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {student.admissionNumber}
                </td>
                <td className="px-3 py-2">
                  <SelectNative
                    value={marks[student.studentId]?.status ?? "present"}
                    onChange={(event) =>
                      setMarks((prev) => ({
                        ...prev,
                        [student.studentId]: {
                          status: event.target.value as AttendanceStatus,
                          notes: prev[student.studentId]?.notes ?? "",
                        },
                      }))
                    }
                    aria-label={`Status for ${student.fullName}`}
                  >
                    {ATTENDANCE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {ATTENDANCE_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </SelectNative>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className="w-full min-w-[8rem] rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    value={marks[student.studentId]?.notes ?? ""}
                    onChange={(event) =>
                      setMarks((prev) => ({
                        ...prev,
                        [student.studentId]: {
                          status: prev[student.studentId]?.status ?? "present",
                          notes: event.target.value,
                        },
                      }))
                    }
                    placeholder="Optional"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-600" role="status">
          {message}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save register"}
      </Button>
    </form>
  );
}
