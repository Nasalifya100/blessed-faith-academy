import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Percent,
  UserX,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getAttendanceByClassReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
import { AttendanceReportTable } from "@/features/reports/components/attendance-report-table";
import { AttendanceTrendPanel } from "@/features/reports/components/attendance-trend-panel";
import {
  ReportFilterBar,
  ReportFilterField,
  reportFilterInputClass,
} from "@/features/reports/components/report-filter-bar";
import {
  BackLink,
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
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
import { schoolToday } from "@/lib/dates";

const REPORT_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isValidDate(value: string): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !REPORT_ROLES.includes(role)) {
    redirect("/dashboard/reports");
  }

  const params = await searchParams;
  const fromParam = firstValue(params.from);
  const toParam = firstValue(params.to);
  const fromDate = isValidDate(fromParam) ? fromParam.slice(0, 10) : undefined;
  const toDate = isValidDate(toParam) ? toParam.slice(0, 10) : undefined;

  const report = await getAttendanceByClassReport({ fromDate, toDate });

  const totals = report.rows.reduce(
    (acc, row) => {
      acc.present += row.present;
      acc.absent += row.absent;
      acc.late += row.late;
      acc.excused += row.excused;
      acc.totalMarks += row.totalMarks;
      return acc;
    },
    { present: 0, absent: 0, late: 0, excused: 0, totalMarks: 0 },
  );

  const attendancePct =
    totals.totalMarks > 0
      ? Math.round(((totals.present + totals.late) / totals.totalMarks) * 100)
      : 0;

  const today = schoolToday();
  const isTodayOnly =
    report.fromDate === today && report.toDate === today;
  const periodHint = isTodayOnly
    ? "Today"
    : report.fromDate && report.toDate
      ? `${report.fromDate} → ${report.toDate}`
      : "Selected period";

  const csv = toCsv(
    [
      "Class",
      "Days recorded",
      "Present",
      "Absent",
      "Late",
      "Excused",
      "Total marks",
      "Attendance rate %",
    ],
    report.rows.map((row) => [
      row.className,
      row.daysRecorded,
      row.present,
      row.absent,
      row.late,
      row.excused,
      row.totalMarks,
      row.totalMarks === 0 ? "" : row.attendanceRate,
    ]),
  );

  const yearSlug = report.academicYearName ?? "current";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Reports"
        title="Attendance"
        description={
          <>
            Blessed Faith Academy
            {report.academicYearName ? ` · ${report.academicYearName}` : ""}.
            Rate = (present + late) ÷ all marks.
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
              filename={`attendance-by-class-${yearSlug}.csv`}
              csv={csv}
            />
            <PrintReportButton />
          </div>
        }
      />

      <form method="get" action="/dashboard/reports/attendance">
        <ReportFilterBar label="Attendance date range">
          <ReportFilterField label="From" htmlFor="from">
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={report.fromDate ?? ""}
              className={reportFilterInputClass}
            />
          </ReportFilterField>
          <ReportFilterField label="To" htmlFor="to">
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={report.toDate ?? ""}
              className={reportFilterInputClass}
            />
          </ReportFilterField>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={cn(buttonVariants({ variant: "default" }), "min-h-11")}
            >
              Apply dates
            </button>
            <Link
              href="/dashboard/reports/attendance"
              className={cn(buttonVariants({ variant: "ghost" }), "min-h-11")}
            >
              Whole year
            </Link>
          </div>
        </ReportFilterBar>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Attendance %"
          value={`${attendancePct}%`}
          hint={periodHint}
          icon={Percent}
          tone={
            attendancePct >= 90
              ? "success"
              : attendancePct >= 75
                ? "warning"
                : "danger"
          }
        />
        <StatCard
          title={isTodayOnly ? "Present today" : "Present"}
          value={String(totals.present)}
          hint="Marks in range"
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          title={isTodayOnly ? "Absent today" : "Absent"}
          value={String(totals.absent)}
          hint="Marks in range"
          icon={UserX}
          tone="danger"
        />
        <StatCard
          title={isTodayOnly ? "Late today" : "Late"}
          value={String(totals.late)}
          hint="Marks in range"
          icon={Clock3}
          tone="warning"
        />
      </div>

      <AttendanceTrendPanel rows={report.rows} />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>By class</CardTitle>
          <CardDescription>
            {report.fromDate && report.toDate
              ? `${report.fromDate} → ${report.toDate}`
              : "No date range"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <EmptyState
              title="No attendance data"
              description="No classes found for the current year, or no registers fall in this date range."
              icon={
                <ClipboardList
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              }
              size="sm"
            />
          ) : (
            <div className="space-y-3">
              <SectionHeading
                title="Class breakdown"
                description="Search and open a register from any row."
              />
              <AttendanceReportTable rows={report.rows} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
