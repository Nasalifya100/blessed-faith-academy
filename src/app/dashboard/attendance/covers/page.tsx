import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  listActiveAttendanceCovers,
  listClassesForAttendance,
  listTeachersForCover,
} from "@/features/attendance/queries";
import { AttendanceCoversPanel } from "@/features/attendance/components/attendance-covers-panel";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
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
  const withoutHomeroom = classes.filter((c) => !c.homeroomTeacherId).length;

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="Attendance"
        title="Homeroom & cover"
        description="Set who normally takes each class register, and assign cover when needed."
        breadcrumb={
          <BackLink href="/dashboard/attendance">Back to attendance</BackLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Classes"
          value={String(classes.length)}
          hint="Current year"
        />
        <StatCard
          title="Active covers"
          value={String(covers.length)}
          hint="Assignments in force"
          tone="warning"
        />
        <StatCard
          title="No homeroom"
          value={String(withoutHomeroom)}
          hint="Classes needing a teacher"
          tone={withoutHomeroom > 0 ? "danger" : "success"}
        />
      </div>

      {loadError ? (
        <p
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {classes.length === 0 ? (
        <EmptyState
          title="No classes available"
          description={
            loadError
              ? "Classes could not be loaded. Fix the error above, then refresh."
              : "No classes available for the current year. Check that an academic year is marked current and classes exist."
          }
          icon={
            <Users className="size-6 text-muted-foreground" aria-hidden />
          }
        />
      ) : teachers.length === 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Teachers needed</CardTitle>
            <CardDescription>
              Cover and homeroom assignment requires active teacher accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No active teachers found"
              description={
                teachersResult.error
                  ? "Teacher list could not be loaded (see error above). After the migration is applied, refresh this page."
                  : "Create a teacher account under Staff first (role = Teacher)."
              }
              size="sm"
              icon={
                <Users className="size-6 text-muted-foreground" aria-hidden />
              }
            />
            {classes.length > 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {classes.length} class
                {classes.length === 1 ? "" : "es"} found for the current year.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <AttendanceCoversPanel
          classes={classes}
          teachers={teachers}
          covers={covers}
        />
      )}
    </PageShell>
  );
}
