import { redirect } from "next/navigation";
import {
  Archive,
  ArrowLeftRight,
  UserPlus,
  Users,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getEnrolmentByClassReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
import { EnrolmentReportTable } from "@/features/reports/components/enrolment-report-table";
import {
  BackLink,
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

const REPORT_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
];

export default async function EnrolmentReportPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !REPORT_ROLES.includes(role)) {
    redirect("/dashboard/reports");
  }

  const report = await getEnrolmentByClassReport();

  const classesWithPupils = report.rows.filter((r) => r.enrolledCount > 0).length;

  const csv = toCsv(
    ["Class", "Enrolled", "Capacity"],
    report.rows.map((row) => [
      row.className,
      row.enrolledCount,
      row.capacity ?? "",
    ]),
  );

  const yearSlug = report.academicYearName ?? "current";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Reports"
        title="Enrolment"
        description={
          <>
            Blessed Faith Academy · active enrolments
            {report.academicYearName
              ? ` for ${report.academicYearName}`
              : " for the current year"}
            .
          </>
        }
        breadcrumb={
          <BackLink href="/dashboard/reports" className="print:hidden">
            Back to reports
          </BackLink>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <DownloadCsvButton
              filename={`enrolment-by-class-${yearSlug}.csv`}
              csv={csv}
            />
            <PrintReportButton />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total students"
          value={String(report.totalEnrolled)}
          hint={`${classesWithPupils} class${classesWithPupils === 1 ? "" : "es"} with pupils`}
          icon={Users}
          tone="info"
        />
        <StatCard
          title="New admissions"
          value="—"
          hint="Not included in this enrolment snapshot"
          icon={UserPlus}
        />
        <StatCard
          title="Transfers"
          value="—"
          hint="Not included in this enrolment snapshot"
          icon={ArrowLeftRight}
        />
        <StatCard
          title="Archived students"
          value="—"
          hint="Not included in this enrolment snapshot"
          icon={Archive}
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>By class</CardTitle>
          <CardDescription>
            {report.totalEnrolled} pupils across {report.rows.length} class
            {report.rows.length === 1 ? "" : "es"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <EmptyState
              title="No enrolment records"
              description="No classes found for the current academic year."
              icon={
                <Users className="size-6 text-muted-foreground" aria-hidden />
              }
              size="sm"
            />
          ) : (
            <div className="space-y-3">
              <SectionHeading
                title="Class enrolment"
                description="Search classes and review capacity status."
              />
              <EnrolmentReportTable rows={report.rows} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
