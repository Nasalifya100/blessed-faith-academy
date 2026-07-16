import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  getClassAttendanceRegister,
  listClassesForAttendance,
} from "@/features/attendance/queries";
import { AttendanceRegisterForm } from "@/features/attendance/components/attendance-register-form";
import { AttendanceDaySummary } from "@/features/attendance/components/attendance-day-summary";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { schoolToday } from "@/lib/dates";

const ATTENDANCE_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDateLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-ZM", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ClassAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !ATTENDANCE_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const { classId } = await params;
  const query = await searchParams;
  const dateParam = firstValue(query.date);
  const attendanceDate =
    dateParam && !Number.isNaN(Date.parse(dateParam))
      ? dateParam.slice(0, 10)
      : schoolToday();

  const { items: allowed } = await listClassesForAttendance();
  const access = allowed.find((cls) => cls.id === classId);
  if (!access) {
    notFound();
  }

  const register = await getClassAttendanceRegister(classId, attendanceDate);
  if (!register) {
    notFound();
  }

  const savedCount = register.students.filter((s) => s.hasExistingMark).length;
  const isComplete =
    savedCount === register.summary.total && register.summary.total > 0;

  const teacherLabel =
    access.accessReason === "cover"
      ? "Cover teacher (you)"
      : access.homeroomTeacherName
        ? `Homeroom: ${access.homeroomTeacherName}`
        : "Homeroom teacher not set";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Attendance"
        title={register.gradeName}
        description={
          <div className="space-y-2">
            <p>
              {register.className !== register.gradeName
                ? `${register.className} · `
                : null}
              {formatDateLabel(attendanceDate)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge
                tone={
                  access.accessReason === "cover"
                    ? "warning"
                    : access.accessReason === "homeroom"
                      ? "success"
                      : "info"
                }
              >
                {access.accessReason === "cover"
                  ? "Cover"
                  : access.accessReason === "homeroom"
                    ? "Homeroom"
                    : "Office"}
              </StatusBadge>
              <span className="text-muted-foreground">{teacherLabel}</span>
              <span className="text-muted-foreground">
                · {register.summary.total} student
                {register.summary.total === 1 ? "" : "s"}
              </span>
              {isComplete ? (
                <StatusBadge tone="success">Saved</StatusBadge>
              ) : savedCount > 0 ? (
                <StatusBadge tone="warning">Partially saved</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Not saved</StatusBadge>
              )}
            </div>
          </div>
        }
        breadcrumb={
          <BackLink href="/dashboard/attendance">Back to attendance</BackLink>
        }
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Daily register</CardTitle>
          <CardDescription>
            Tap a status for each student, then save. Change the date to view or
            edit another day.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            method="get"
            action={`/dashboard/attendance/${classId}`}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={attendanceDate}
                className="w-auto min-h-11"
              />
            </div>
            <Button type="submit" variant="outline" className="min-h-11">
              Load date
            </Button>
          </form>

          <AttendanceDaySummary register={register} />

          <AttendanceRegisterForm
            key={`${classId}-${attendanceDate}`}
            classId={classId}
            attendanceDate={attendanceDate}
            students={register.students}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
