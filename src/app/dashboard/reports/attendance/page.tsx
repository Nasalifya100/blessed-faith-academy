import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getAttendanceByClassReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/dashboard/reports"
            className="text-sm text-muted-foreground hover:underline print:hidden"
          >
            &larr; Back to reports
          </Link>
          <h1 className="text-2xl font-bold">Attendance by class</h1>
          <p className="text-muted-foreground">
            Blessed Faith Academy
            {report.academicYearName ? ` · ${report.academicYearName}` : ""}.
            Rate = (present + late) ÷ all marks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <DownloadCsvButton
            filename={`attendance-by-class-${yearSlug}.csv`}
            csv={csv}
          />
          <PrintReportButton />
        </div>
      </div>

      <form
        method="get"
        action="/dashboard/reports/attendance"
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4 print:hidden"
      >
        <div className="space-y-1">
          <label htmlFor="from" className="text-xs text-muted-foreground">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={report.fromDate ?? ""}
            className="block rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="text-xs text-muted-foreground">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={report.toDate ?? ""}
            className="block rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <button
          type="submit"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Apply dates
        </button>
        <Link
          href="/dashboard/reports/attendance"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Whole year
        </Link>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>
            {report.fromDate && report.toDate
              ? `${report.fromDate} → ${report.toDate}`
              : "No date range"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No classes found for the current year.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Present</TableHead>
                    <TableHead className="text-right">Absent</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">Excused</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="print:hidden" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.classId}>
                      <TableCell className="font-medium">
                        {row.className}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.daysRecorded}
                      </TableCell>
                      <TableCell className="text-right">{row.present}</TableCell>
                      <TableCell className="text-right">{row.absent}</TableCell>
                      <TableCell className="text-right">{row.late}</TableCell>
                      <TableCell className="text-right">{row.excused}</TableCell>
                      <TableCell className="text-right font-medium">
                        {row.totalMarks === 0 ? "—" : `${row.attendanceRate}%`}
                      </TableCell>
                      <TableCell className="text-right print:hidden">
                        <Link
                          href={`/dashboard/attendance/${row.classId}`}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })}
                        >
                          Register
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
