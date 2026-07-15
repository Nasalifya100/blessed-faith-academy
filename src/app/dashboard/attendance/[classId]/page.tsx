import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  getClassAttendanceRegister,
  listClassesForAttendance,
} from "@/features/attendance/queries";
import { AttendanceRegisterForm } from "@/features/attendance/components/attendance-register-form";
import { AttendanceDaySummary } from "@/features/attendance/components/attendance-day-summary";
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
  if (!allowed.some((cls) => cls.id === classId)) {
    notFound();
  }

  const register = await getClassAttendanceRegister(classId, attendanceDate);
  if (!register) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/dashboard/attendance"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to attendance
        </Link>
        <h1 className="text-2xl font-bold">{register.gradeName}</h1>
        <p className="text-muted-foreground">
          Daily register · {register.summary.total} enrolled student
          {register.summary.total === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register for {attendanceDate}</CardTitle>
          <CardDescription>
            Change the date to view or edit another day. Defaults to present for
            students not yet marked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            method="get"
            action={`/dashboard/attendance/${classId}`}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-1">
              <label htmlFor="date" className="text-xs text-muted-foreground">
                Date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={attendanceDate}
                className="block rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            >
              Load date
            </button>
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
    </div>
  );
}
