import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listClassesForAttendance } from "@/features/attendance/queries";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ATTENDANCE_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const COVER_MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

const ACCESS_LABELS: Record<string, string> = {
  office: "Office access",
  homeroom: "Your homeroom",
  cover: "Cover assignment",
};

export default async function AttendancePage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !ATTENDANCE_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const canManageCovers = COVER_MANAGER_ROLES.includes(role);
  const { items: classes, error: classesError } =
    await listClassesForAttendance();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Attendance</h1>
          <p className="text-muted-foreground">
            Take the daily class register. Teachers see their homeroom (and any
            cover classes); office staff see all classes.
          </p>
        </div>
        {canManageCovers ? (
          <Link
            href="/dashboard/attendance/covers"
            className={buttonVariants({ variant: "outline" })}
          >
            Homeroom &amp; cover
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Classes you can mark</CardTitle>
          <CardDescription>
            Open a class to mark today&apos;s register (or pick another date on
            the next screen).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {classesError ? (
            <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {classesError}
            </p>
          ) : null}
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {classesError
                ? "Classes could not be loaded. Fix the error above, then refresh."
                : role === "teacher"
                  ? "You are not the homeroom teacher for any class, and you have no active cover assignment. Ask the office to set your homeroom or assign cover."
                  : "No active classes found for the current academic year."}
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Homeroom</TableHead>
                    <TableHead>Your access</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((cls) => (
                    <TableRow key={cls.id}>
                      <TableCell className="font-medium">
                        {cls.gradeName}
                      </TableCell>
                      <TableCell>
                        {cls.homeroomTeacherName ?? (
                          <span className="text-muted-foreground">Not set</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ACCESS_LABELS[cls.accessReason] ?? cls.accessReason}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/dashboard/attendance/${cls.id}?date=${today}`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Take register
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
