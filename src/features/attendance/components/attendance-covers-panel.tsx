"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, UserRound } from "lucide-react";

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
import { SectionHeading } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { schoolToday } from "@/lib/dates";

interface AttendanceCoversPanelProps {
  classes: AttendanceClassOption[];
  teachers: TeacherOption[];
  covers: AttendanceCoverRow[];
}

const today = () => schoolToday();

function coverIsExpired(cover: AttendanceCoverRow, todayIso: string): boolean {
  if (!cover.validUntil) return false;
  return cover.validUntil < todayIso;
}

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

  const todayIso = today();

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
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Set homeroom teacher</CardTitle>
          <CardDescription>
            The homeroom teacher can always take the register for their class.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSetHomeroom} className="space-y-4">
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
                  className="h-11"
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
                  className="h-11"
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
            <Button
              type="submit"
              className="min-h-11"
              disabled={isPending || !homeroomClassId}
            >
              Save homeroom
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Assign cover teacher</CardTitle>
          <CardDescription>
            Use when the homeroom teacher is absent or another teacher needs to
            take the register for a while.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAssign} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cover-class">Class</Label>
                <SelectNative
                  id="cover-class"
                  value={classId}
                  onChange={(event) => setClassId(event.target.value)}
                  className="h-11"
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
                  className="h-11"
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
                  className="min-h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="valid-until">Until (optional)</Label>
                <Input
                  id="valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Homeroom teacher on leave"
                  className="min-h-11"
                />
              </div>
            </div>
            <Button
              type="submit"
              className="min-h-11"
              disabled={
                isPending || !classId || !staffId || teachers.length === 0
              }
            >
              Assign cover
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <SectionHeading
          title="Current cover assignments"
          description="Active cover teachers and their date ranges."
        />
        {covers.length === 0 ? (
          <EmptyState
            title="No cover assignments"
            description="Assign a cover teacher above when a homeroom teacher is away."
            size="sm"
            icon={
              <UserRound
                className="size-6 text-muted-foreground"
                aria-hidden
              />
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {covers.map((cover) => {
              const expired = coverIsExpired(cover, todayIso);
              const active = cover.isActive && !expired;
              return (
                <li key={cover.id}>
                  <Card className="h-full shadow-sm">
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <CardTitle className="text-base">
                          {cover.className}
                        </CardTitle>
                        {active ? (
                          <StatusBadge tone="success">Active</StatusBadge>
                        ) : expired ? (
                          <StatusBadge tone="neutral">Expired</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Inactive</StatusBadge>
                        )}
                      </div>
                      <CardDescription className="flex items-center gap-1.5">
                        <UserRound className="size-3.5 shrink-0" aria-hidden />
                        {cover.staffName}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                        <CalendarRange
                          className="mt-0.5 size-3.5 shrink-0"
                          aria-hidden
                        />
                        <span>
                          {cover.validFrom}
                          {cover.validUntil
                            ? ` → ${cover.validUntil}`
                            : " (open-ended)"}
                        </span>
                      </p>
                      {cover.reason ? (
                        <p className="text-sm text-muted-foreground">
                          {cover.reason}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10 w-full sm:w-auto"
                        disabled={isPending}
                        onClick={() => onRevoke(cover.id)}
                      >
                        End cover
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
