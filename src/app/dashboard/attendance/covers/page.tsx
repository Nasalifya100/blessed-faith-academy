import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  listActiveAttendanceCovers,
  listClassesForAttendance,
  listTeachersForCover,
} from "@/features/attendance/queries";
import { AttendanceCoversPanel } from "@/features/attendance/components/attendance-covers-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const COVER_MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

export default async function AttendanceCoversPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !COVER_MANAGER_ROLES.includes(role)) {
    redirect("/dashboard/attendance");
  }

  const [classesResult, teachersResult, covers] = await Promise.all([
    listClassesForAttendance(),
    listTeachersForCover(),
    listActiveAttendanceCovers(),
  ]);

  const classes = classesResult.items;
  const teachers = teachersResult.items;
  const loadError = classesResult.error ?? teachersResult.error;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/dashboard/attendance"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to attendance
        </Link>
        <h1 className="text-2xl font-bold">Homeroom &amp; cover</h1>
        <p className="text-muted-foreground">
          Set who normally takes each class register, and assign cover when
          needed.
        </p>
      </div>

      {loadError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Manage access</CardTitle>
          <CardDescription>
            Teachers only appear here if their role is Teacher and their account
            is active.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loadError
                ? "Classes could not be loaded. Fix the error above, then refresh."
                : "No classes available for the current year. Check that academic year 2026 is marked current and classes exist (Students or Fees pages should show them)."}
            </p>
          ) : teachers.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {teachersResult.error
                  ? "Teacher list could not be loaded (see error above). After the migration is applied, refresh this page."
                  : "No active teachers found. Create a teacher account under Staff first (role = Teacher)."}
              </p>
              {classes.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {classes.length} class
                  {classes.length === 1 ? "" : "es"} found for the current year.
                </p>
              ) : null}
            </div>
          ) : (
            <AttendanceCoversPanel
              classes={classes}
              teachers={teachers}
              covers={covers}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
