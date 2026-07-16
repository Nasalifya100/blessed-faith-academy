import Link from "next/link";
import {
  ClipboardList,
  FileText,
  GraduationCap,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canBrowseStudents,
  canManageApplications,
  canManageStudents,
} from "@/features/auth/permissions";
import { ROLE_LABELS, type StaffRole } from "@/features/auth/types";
import {
  getAttendanceByClassReport,
  getDisciplineSnapshotReport,
  getEnrolmentByClassReport,
  getFeeBalancesReport,
} from "@/features/reports/queries";
import { formatKwacha } from "@/lib/money";
import {
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  DashboardEmptyState,
  DashboardQuickAction,
  DashboardStatCard,
} from "@/features/dashboard/components/dashboard-widgets";

const FEE_ROLES: StaffRole[] = [
  "administrator",
  "bursar",
  "headteacher",
  "secretary",
];
const ATTENDANCE_ROLES: StaffRole[] = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const DISCIPLINE_ROLES: StaffRole[] = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const REPORT_ROLES: StaffRole[] = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
];

export async function DashboardHome() {
  const current = await getCurrentUser();
  const profile = current?.profile ?? null;
  const role = profile?.role;

  const canSeeStudents = canBrowseStudents(role);
  const canSeeApplications = canManageApplications(role);
  const canAddStudent = canManageStudents(role);
  const canSeeFees = Boolean(role && FEE_ROLES.includes(role));
  const canSeeAttendance = Boolean(role && ATTENDANCE_ROLES.includes(role));
  const canSeeDiscipline = Boolean(role && DISCIPLINE_ROLES.includes(role));
  const canSeeReports = Boolean(role && REPORT_ROLES.includes(role));
  const canSeeStaff = role === "administrator";

  const [fees, attendance, enrolment, discipline] = await Promise.all([
    canSeeFees
      ? getFeeBalancesReport({ outstandingOnly: true })
      : Promise.resolve(null),
    canSeeAttendance || canSeeReports
      ? getAttendanceByClassReport()
      : Promise.resolve(null),
    canSeeStudents || canSeeReports
      ? getEnrolmentByClassReport()
      : Promise.resolve(null),
    canSeeDiscipline
      ? getDisciplineSnapshotReport()
      : Promise.resolve(null),
  ]);

  const yearLabel =
    enrolment?.academicYearName ??
    fees?.academicYearName ??
    attendance?.academicYearName ??
    null;

  const stats: {
    title: string;
    value: string;
    description: string;
    href?: string;
    tone?: "default" | "warning" | "danger";
  }[] = [];

  if (enrolment) {
    stats.push({
      title: "Enrolment",
      value: String(enrolment.totalEnrolled),
      description: yearLabel
        ? `Active pupils · ${yearLabel}`
        : "Active pupils this year",
      href: canSeeReports
        ? "/dashboard/reports/enrolment"
        : "/dashboard/students",
    });
  }

  if (fees) {
    stats.push({
      title: "Outstanding fees",
      value: formatKwacha(fees.totals.balance),
      description: `${fees.totals.studentsWithBalance} student${
        fees.totals.studentsWithBalance === 1 ? "" : "s"
      } with a balance`,
      href: "/dashboard/reports/fee-balances",
      tone: fees.totals.balance > 0 ? "danger" : "default",
    });
  }

  if (attendance) {
    stats.push({
      title: "Attendance",
      value: String(attendance.rows.length),
      description: "Classes in the current year",
      href: canSeeAttendance
        ? "/dashboard/attendance"
        : "/dashboard/reports/attendance",
    });
  }

  if (discipline) {
    stats.push({
      title: "Open incidents",
      value: String(discipline.openCount),
      description:
        discipline.highOpenCount > 0
          ? `${discipline.highOpenCount} high severity`
          : `${discipline.resolvedCount} resolved`,
      href: "/dashboard/discipline?status=open",
      tone: discipline.openCount > 0 ? "warning" : "default",
    });
  }

  const quickActions = [
    canSeeStudents
      ? {
          href: "/dashboard/students",
          title: "Students",
          description: "Browse and open student profiles",
          icon: GraduationCap,
        }
      : null,
    canAddStudent
      ? {
          href: "/dashboard/students/new",
          title: "Add student",
          description: "Enrol a pupil for the current year",
          icon: Users,
        }
      : null,
    canSeeApplications
      ? {
          href: "/dashboard/applications",
          title: "Applications",
          description: "Review and process applications",
          icon: FileText,
        }
      : null,
    canSeeAttendance
      ? {
          href: "/dashboard/attendance",
          title: "Attendance",
          description: "Take registers and manage cover",
          icon: ClipboardList,
        }
      : null,
    canSeeFees
      ? {
          href: "/dashboard/fees",
          title: "Fees",
          description: "Catalogue, charges, and requirements",
          icon: Wallet,
        }
      : null,
    canSeeDiscipline
      ? {
          href: "/dashboard/discipline",
          title: "Discipline",
          description: "Open and resolve incidents",
          icon: ShieldAlert,
        }
      : null,
    canSeeReports
      ? {
          href: "/dashboard/reports",
          title: "Reports",
          description: "Enrolment, fees, and attendance snapshots",
          icon: FileText,
        }
      : null,
    canSeeStaff
      ? {
          href: "/dashboard/staff",
          title: "Staff",
          description: "Create and manage staff accounts",
          icon: Users,
        }
      : null,
  ].filter(Boolean) as {
    href: string;
    title: string;
    description: string;
    icon: typeof GraduationCap;
  }[];

  type ActivityItem = {
    label: string;
    detail: string;
    href: string;
  };

  const activity: ActivityItem[] = [];

  if (discipline && discipline.openCount > 0) {
    activity.push({
      label: "Discipline needs attention",
      detail: `${discipline.openCount} open incident${
        discipline.openCount === 1 ? "" : "s"
      }${
        discipline.highOpenCount > 0
          ? ` · ${discipline.highOpenCount} high severity`
          : ""
      }`,
      href: "/dashboard/discipline?status=open",
    });
  }

  if (fees && fees.totals.studentsWithBalance > 0) {
    activity.push({
      label: "Outstanding fee balances",
      detail: `${fees.totals.studentsWithBalance} student${
        fees.totals.studentsWithBalance === 1 ? "" : "s"
      } · ${formatKwacha(fees.totals.balance)} total`,
      href: "/dashboard/reports/fee-balances",
    });
  }

  if (canSeeApplications) {
    activity.push({
      label: "Review applications",
      detail: "Open the applications queue to approve or reject",
      href: "/dashboard/applications",
    });
  }

  if (canSeeAttendance) {
    activity.push({
      label: "Take attendance",
      detail: "Mark today’s register for your classes",
      href: "/dashboard/attendance",
    });
  }

  const roleLabel = profile
    ? ROLE_LABELS[profile.role]
    : "a user with no role assigned";

  return (
    <PageShell className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
        description={
          <>
            Signed in as{" "}
            <span className="font-medium text-foreground">{roleLabel}</span>
            {yearLabel ? (
              <>
                {" "}
                · Current year{" "}
                <span className="font-medium text-foreground">{yearLabel}</span>
              </>
            ) : null}
            . Use the shortcuts below to continue school work.
          </>
        }
      />

      <section className="space-y-4" aria-labelledby="dashboard-stats-heading">
        <SectionHeading title="At a glance" />
        <h2 id="dashboard-stats-heading" className="sr-only">
          At a glance
        </h2>
        {stats.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <DashboardStatCard key={stat.title} {...stat} />
            ))}
          </div>
        ) : (
          <DashboardEmptyState
            title="No statistics for your role"
            description="When your role includes students, fees, attendance, or discipline, summary figures will appear here."
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="dashboard-actions-heading">
        <SectionHeading title="Quick actions" />
        <h2 id="dashboard-actions-heading" className="sr-only">
          Quick actions
        </h2>
        {quickActions.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => (
              <DashboardQuickAction key={action.href} {...action} />
            ))}
          </div>
        ) : (
          <DashboardEmptyState
            title="No shortcuts available"
            description="Ask an administrator to assign an active staff role so you can open school modules."
          />
        )}
      </section>

      <section
        className="space-y-4"
        aria-labelledby="dashboard-activity-heading"
      >
        <SectionHeading
          title="Recent activity"
          description="Live prompts from modules you can already access — not a full audit log."
        />
        <h2 id="dashboard-activity-heading" className="sr-only">
          Recent activity
        </h2>
        <Card>
          <CardContent>
            {activity.length > 0 ? (
              <ul className="divide-y rounded-xl border">
                {activity.map((item) => (
                  <li key={item.href + item.label}>
                    <Link
                      href={item.href}
                      className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {item.detail}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <DashboardEmptyState
                title="Nothing waiting right now"
                description="Outstanding fees, open discipline cases, and role shortcuts will show up here when there is work to do."
              />
            )}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
