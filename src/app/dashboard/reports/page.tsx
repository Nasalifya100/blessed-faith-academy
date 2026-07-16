import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  Eye,
  Printer,
  Users,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
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
  BackLink,
} from "@/components/layout/page-shell";
import { StatCard } from "@/components/ui/stat-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const REPORT_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
];
const FEE_REPORT_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
];

function overallAttendanceRate(
  rows: { present: number; late: number; totalMarks: number }[],
): number {
  const present = rows.reduce((sum, row) => sum + row.present + row.late, 0);
  const total = rows.reduce((sum, row) => sum + row.totalMarks, 0);
  if (total === 0) return 0;
  return Math.round((present / total) * 100);
}

export default async function ReportsHubPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !REPORT_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const canSeeFees = FEE_REPORT_ROLES.includes(role);

  const [fees, attendance, enrolment, discipline] = await Promise.all([
    canSeeFees
      ? getFeeBalancesReport({ outstandingOnly: true })
      : Promise.resolve(null),
    getAttendanceByClassReport(),
    getEnrolmentByClassReport(),
    getDisciplineSnapshotReport(),
  ]);

  const attendanceRate = overallAttendanceRate(attendance.rows);
  const yearLabel =
    enrolment.academicYearName ??
    attendance.academicYearName ??
    fees?.academicYearName ??
    null;

  const reports = [
    {
      name: "Attendance",
      description:
        "Class registers and attendance rates for the selected period.",
      href: "/dashboard/reports/attendance",
      icon: ClipboardList,
      meta: `${attendanceRate}% overall · ${attendance.rows.length} classes`,
    },
    canSeeFees
      ? {
          name: "Fee Balances",
          description:
            "Outstanding balances, charged totals, and students owing.",
          href: "/dashboard/reports/fee-balances",
          icon: Wallet,
          meta: fees
            ? `${formatKwacha(fees.totals.balance)} outstanding`
            : "Fee snapshot",
        }
      : null,
    {
      name: "Enrolment",
      description: "Active pupils by class for the current academic year.",
      href: "/dashboard/reports/enrolment",
      icon: Users,
      meta: `${enrolment.totalEnrolled} enrolled`,
    },
    {
      name: "Discipline",
      description: "Open and resolved incidents across the school.",
      href: "/dashboard/reports/discipline",
      icon: AlertTriangle,
      meta: `${discipline.openCount} open · ${discipline.resolvedCount} resolved`,
    },
  ].filter(Boolean) as {
    name: string;
    description: string;
    href: string;
    icon: typeof ClipboardList;
    meta: string;
  }[];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        description={
          <>
            Executive snapshot
            {yearLabel ? ` · ${yearLabel}` : ""}. Summaries first — open a report
            for the full table, export, or print.
          </>
        }
        breadcrumb={<BackLink href="/dashboard">Back to dashboard</BackLink>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total students"
          value={String(enrolment.totalEnrolled)}
          hint="Active enrolments this year"
          icon={Users}
          tone="info"
          href="/dashboard/reports/enrolment"
        />
        <StatCard
          title="Attendance rate"
          value={`${attendanceRate}%`}
          hint="Present + late across all marks"
          icon={ClipboardList}
          tone={attendanceRate >= 90 ? "success" : attendanceRate >= 75 ? "warning" : "danger"}
          href="/dashboard/reports/attendance"
        />
        {canSeeFees && fees ? (
          <StatCard
            title="Outstanding fees"
            value={formatKwacha(fees.totals.balance)}
            hint={`${fees.totals.studentsWithBalance} student${fees.totals.studentsWithBalance === 1 ? "" : "s"} owing`}
            icon={Wallet}
            tone={fees.totals.balance > 0 ? "danger" : "success"}
            href="/dashboard/reports/fee-balances"
          />
        ) : (
          <StatCard
            title="Outstanding fees"
            value="—"
            hint="Not available for your role"
            icon={Wallet}
          />
        )}
        <StatCard
          title="Open discipline"
          value={String(discipline.openCount)}
          hint={`${discipline.highOpenCount} high severity · ${discipline.resolvedCount} resolved`}
          icon={AlertTriangle}
          tone={discipline.openCount > 0 ? "warning" : "success"}
          href="/dashboard/reports/discipline"
        />
      </div>

      <section className="space-y-3">
        <SectionHeading
          title="Report library"
          description="View summaries, export CSV, or print any report."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {reports.map((report) => {
            const Icon = report.icon;
            return (
              <Card key={report.href} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Icon
                        className="size-5 text-muted-foreground"
                        aria-hidden
                      />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-lg">{report.name}</CardTitle>
                      <CardDescription>{report.description}</CardDescription>
                      <p className="text-xs text-muted-foreground">
                        {report.meta}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={report.href}
                      className={cn(
                        buttonVariants({ variant: "default", size: "sm" }),
                        "min-h-10",
                      )}
                    >
                      <Eye className="size-4" aria-hidden />
                      View
                    </Link>
                    <Link
                      href={report.href}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "min-h-10",
                      )}
                    >
                      <Download className="size-4" aria-hidden />
                      Export
                    </Link>
                    <Link
                      href={report.href}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "min-h-10",
                      )}
                    >
                      <Printer className="size-4" aria-hidden />
                      Print
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}
