import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Shield,
  UserRound,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  listActiveAttendanceCovers,
  listClassesForAttendance,
  type AttendanceClassOption,
} from "@/features/attendance/queries";
import {
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { schoolToday } from "@/lib/dates";
import { cn } from "@/lib/utils";

const ATTENDANCE_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const COVER_MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

const ACCESS_LABELS: Record<AttendanceClassOption["accessReason"], string> = {
  office: "Office",
  homeroom: "Homeroom",
  cover: "Cover",
};

const ACCESS_TONE: Record<
  AttendanceClassOption["accessReason"],
  "success" | "warning" | "info"
> = {
  office: "info",
  homeroom: "success",
  cover: "warning",
};

function formatTodayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-ZM", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ClassRegisterCards({
  classes,
  today,
}: {
  classes: AttendanceClassOption[];
  today: string;
}) {
  if (classes.length === 0) {
    return (
      <EmptyState
        title="No classes in this group"
        description="Nothing to show here for today."
        size="sm"
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {classes.map((cls) => (
        <li key={cls.id}>
          <Card className="h-full shadow-sm transition-colors hover:bg-muted/30">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-base">{cls.gradeName}</CardTitle>
                <StatusBadge tone={ACCESS_TONE[cls.accessReason]}>
                  {ACCESS_LABELS[cls.accessReason]}
                </StatusBadge>
              </div>
              <CardDescription>
                Homeroom: {cls.homeroomTeacherName ?? "Not set"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/dashboard/attendance/${cls.id}?date=${today}`}
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "w-full sm:w-auto",
                )}
              >
                Take register
              </Link>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default async function AttendancePage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !ATTENDANCE_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const canManageCovers = COVER_MANAGER_ROLES.includes(role);
  const [{ items: classes, error: classesError }, covers] = await Promise.all([
    listClassesForAttendance(),
    listActiveAttendanceCovers(),
  ]);
  const today = schoolToday();
  const todayLabel = formatTodayLabel(today);

  const homeroom = classes.filter((c) => c.accessReason === "homeroom");
  const cover = classes.filter((c) => c.accessReason === "cover");
  const office = classes.filter((c) => c.accessReason === "office");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Attendance"
        title="Attendance"
        description={
          <>
            <span className="block">{todayLabel}</span>
            <span className="mt-1 block text-sm">
              Take the daily class register. Open a class below to mark present,
              absent, late, or excused.
            </span>
          </>
        }
        actions={
          canManageCovers ? (
            <Link
              href="/dashboard/attendance/covers"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Homeroom &amp; cover
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Today"
          value={today}
          hint={todayLabel}
          icon={CalendarDays}
        />
        <StatCard
          title="Classes to mark"
          value={String(classes.length)}
          hint="Classes you can take today"
          icon={ClipboardList}
          tone="info"
        />
        <StatCard
          title="Homeroom"
          value={String(homeroom.length)}
          hint="Your assigned classes"
          icon={UserRound}
          tone="success"
        />
        <StatCard
          title="Cover access"
          value={String(cover.length)}
          hint={
            covers.length > 0
              ? `${covers.length} active cover assignment${covers.length === 1 ? "" : "s"}`
              : "Active cover classes"
          }
          icon={Clock}
          tone="warning"
        />
      </div>

      {office.length > 0 ? (
        <StatCard
          title="Office-accessible"
          value={String(office.length)}
          hint="All classes for office roles"
          icon={Shield}
          tone="info"
        />
      ) : null}

      {classesError ? (
        <p
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {classesError}
        </p>
      ) : null}

      {classes.length === 0 ? (
        <EmptyState
          title="No classes assigned"
          description={
            classesError
              ? "Classes could not be loaded. Fix the error above, then refresh."
              : role === "teacher"
                ? "You are not the homeroom teacher for any class, and you have no active cover assignment. Ask the office to set your homeroom or assign cover."
                : "No active classes found for the current academic year."
          }
          icon={
            <ClipboardList
              className="size-6 text-muted-foreground"
              aria-hidden
            />
          }
        />
      ) : (
        <div className="space-y-8">
          {homeroom.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                title="My homeroom classes"
                description="Classes where you are the assigned homeroom teacher."
              />
              <ClassRegisterCards classes={homeroom} today={today} />
            </section>
          ) : null}

          {cover.length > 0 || covers.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                title="Active cover assignments"
                description="Classes you can mark while covering for another teacher."
              />
              {cover.length > 0 ? (
                <ClassRegisterCards classes={cover} today={today} />
              ) : (
                <EmptyState
                  title="No cover classes for you"
                  description={
                    canManageCovers
                      ? "Cover assignments exist school-wide. Manage them under Homeroom & cover."
                      : "You have no active cover assignment right now."
                  }
                  size="sm"
                  icon={
                    <CheckCircle2
                      className="size-6 text-muted-foreground"
                      aria-hidden
                    />
                  }
                  action={
                    canManageCovers ? (
                      <Link
                        href="/dashboard/attendance/covers"
                        className={cn(buttonVariants({ variant: "outline" }))}
                      >
                        Manage covers
                      </Link>
                    ) : null
                  }
                />
              )}
            </section>
          ) : null}

          {office.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                title="Office-accessible classes"
                description="All current-year classes available to office staff."
              />
              <ClassRegisterCards classes={office} today={today} />
            </section>
          ) : null}

          {homeroom.length === 0 &&
          cover.length === 0 &&
          office.length === 0 ? (
            <ClassRegisterCards classes={classes} today={today} />
          ) : null}
        </div>
      )}
    </PageShell>
  );
}
