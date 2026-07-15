"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  assignAttendanceCoverAction,
  revokeAttendanceCoverAction,
  setHomeroomTeacherAction,
} from "@/features/attendance/actions";
import type {
  AttendanceClassOption,
  AttendanceCoverRow,
  TeacherOption,
} from "@/features/attendance/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface AttendanceCoversPanelProps {
  classes: AttendanceClassOption[];
  teachers: TeacherOption[];
  covers: AttendanceCoverRow[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function AttendanceCoversPanel({
  classes,
  teachers,
  covers,
}: AttendanceCoversPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [staffId, setStaffId] = useState(teachers[0]?.id ?? "");
  const [validFrom, setValidFrom] = useState(today());
  const [validUntil, setValidUntil] = useState("");
  const [reason, setReason] = useState("");

  const [homeroomClassId, setHomeroomClassId] = useState(classes[0]?.id ?? "");
  const [homeroomStaffId, setHomeroomStaffId] = useState(
    classes[0]?.homeroomTeacherId ?? "",
  );

  function onAssign(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await assignAttendanceCoverAction({
        classId,
        staffId,
        validFrom,
        validUntil,
        reason,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Cover teacher assigned.");
      setReason("");
      router.refresh();
    });
  }

  function onRevoke(coverId: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await revokeAttendanceCoverAction({ coverId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Cover assignment ended.");
      router.refresh();
    });
  }

  function onSetHomeroom(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setHomeroomTeacherAction({
        classId: homeroomClassId,
        staffId: homeroomStaffId || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Homeroom teacher updated.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <form onSubmit={onSetHomeroom} className="space-y-4 rounded-lg border p-4">
        <h3 className="font-medium">Set homeroom teacher</h3>
        <p className="text-sm text-muted-foreground">
          The homeroom teacher can always take the register for their class.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="homeroom-class">Class</Label>
            <SelectNative
              id="homeroom-class"
              value={homeroomClassId}
              onChange={(event) => {
                const nextId = event.target.value;
                setHomeroomClassId(nextId);
                const match = classes.find((c) => c.id === nextId);
                setHomeroomStaffId(match?.homeroomTeacherId ?? "");
              }}
            >
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.gradeName}
                  {cls.homeroomTeacherName
                    ? ` — ${cls.homeroomTeacherName}`
                    : " — no homeroom"}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-2">
            <Label htmlFor="homeroom-teacher">Teacher</Label>
            <SelectNative
              id="homeroom-teacher"
              value={homeroomStaffId}
              onChange={(event) => setHomeroomStaffId(event.target.value)}
            >
              <option value="">— None —</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </SelectNative>
          </div>
        </div>
        <Button type="submit" disabled={isPending || !homeroomClassId}>
          Save homeroom
        </Button>
      </form>

      <form onSubmit={onAssign} className="space-y-4 rounded-lg border p-4">
        <h3 className="font-medium">Assign cover teacher</h3>
        <p className="text-sm text-muted-foreground">
          Use when the homeroom teacher is absent or another teacher needs to
          take the register for a while.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cover-class">Class</Label>
            <SelectNative
              id="cover-class"
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
            >
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.gradeName}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cover-teacher">Cover teacher</Label>
            <SelectNative
              id="cover-teacher"
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-2">
            <Label htmlFor="valid-from">From</Label>
            <Input
              id="valid-from"
              type="date"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="valid-until">Until (optional)</Label>
            <Input
              id="valid-until"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Homeroom teacher on leave"
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={isPending || !classId || !staffId || teachers.length === 0}
        >
          Assign cover
        </Button>
      </form>

      <div className="space-y-2">
        <h3 className="font-medium">Active cover assignments</h3>
        {covers.length === 0 ? (
          <p className="text-sm text-muted-foreground">None right now.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {covers.map((cover) => (
              <li
                key={cover.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
              >
                <div>
                  <p>
                    <span className="font-medium">{cover.staffName}</span>
                    {" → "}
                    {cover.className}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {cover.validFrom}
                    {cover.validUntil ? ` to ${cover.validUntil}` : " (open-ended)"}
                    {cover.reason ? ` · ${cover.reason}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onRevoke(cover.id)}
                >
                  End cover
                </Button>
              </li>
            ))}
          </ul>
        )}
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
    </div>
  );
}
