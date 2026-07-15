import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getEnrolmentByClassReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
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

export default async function EnrolmentReportPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !REPORT_ROLES.includes(role)) {
    redirect("/dashboard/reports");
  }

  const report = await getEnrolmentByClassReport();

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/dashboard/reports"
            className="text-sm text-muted-foreground hover:underline print:hidden"
          >
            &larr; Back to reports
          </Link>
          <h1 className="text-2xl font-bold">Enrolment by class</h1>
          <p className="text-muted-foreground">
            Blessed Faith Academy · active enrolments
            {report.academicYearName
              ? ` for ${report.academicYearName}`
              : " for the current year"}
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <DownloadCsvButton
            filename={`enrolment-by-class-${yearSlug}.csv`}
            csv={csv}
          />
          <PrintReportButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{report.totalEnrolled} pupils enrolled</CardTitle>
          <CardDescription>
            Across {report.rows.length} class
            {report.rows.length === 1 ? "" : "es"}
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
                    <TableHead className="text-right">Enrolled</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.classId}>
                      <TableCell className="font-medium">
                        {row.className}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.enrolledCount}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.capacity ?? "—"}
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
