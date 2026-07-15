import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  getAttendanceByClassReport,
  getDisciplineSnapshotReport,
  getEnrolmentByClassReport,
  getFeeBalancesReport,
} from "@/features/reports/queries";
import { formatKwacha } from "@/lib/money";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Snapshots for the current academic year. Open a report for the full
          table.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {canSeeFees && fees ? (
          <Card>
            <CardHeader>
              <CardTitle>Fee balances</CardTitle>
              <CardDescription>
                Outstanding balances
                {fees.academicYearName ? ` · ${fees.academicYearName}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-2xl font-semibold text-destructive">
                {formatKwacha(fees.totals.balance)}
              </p>
              <p className="text-sm text-muted-foreground">
                {fees.totals.studentsWithBalance} student
                {fees.totals.studentsWithBalance === 1 ? "" : "s"} with a balance
              </p>
              <Link
                href="/dashboard/reports/fee-balances"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open report
              </Link>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
            <CardDescription>
              By class
              {attendance.academicYearName
                ? ` · ${attendance.academicYearName}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">
              {attendance.rows.length} class
              {attendance.rows.length === 1 ? "" : "es"}
            </p>
            <p className="text-sm text-muted-foreground">
              Present + late counted as in school
            </p>
            <Link
              href="/dashboard/reports/attendance"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open report
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enrolment</CardTitle>
            <CardDescription>
              Pupils per class
              {enrolment.academicYearName
                ? ` · ${enrolment.academicYearName}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">{enrolment.totalEnrolled}</p>
            <p className="text-sm text-muted-foreground">
              Active enrolments this year
            </p>
            <Link
              href="/dashboard/reports/enrolment"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open report
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discipline</CardTitle>
            <CardDescription>Open vs resolved incidents</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">{discipline.openCount} open</p>
            <p className="text-sm text-muted-foreground">
              {discipline.highOpenCount} high severity ·{" "}
              {discipline.resolvedCount} resolved
            </p>
            <Link
              href="/dashboard/discipline?status=open"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              View incidents
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
