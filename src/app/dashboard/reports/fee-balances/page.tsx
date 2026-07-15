import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getFeeBalancesReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
import { formatKwacha } from "@/lib/money";
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

const FEE_REPORT_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function FeeBalancesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !FEE_REPORT_ROLES.includes(role)) {
    redirect("/dashboard/reports");
  }

  const params = await searchParams;
  const showAll = firstValue(params.view) === "all";
  const report = await getFeeBalancesReport({ outstandingOnly: !showAll });

  const csv = toCsv(
    ["Admission number", "Student", "Class", "Charged", "Paid", "Balance"],
    report.rows.map((row) => [
      row.admissionNumber,
      row.fullName,
      row.className ?? "",
      row.totalCharged.toFixed(2),
      row.totalPaid.toFixed(2),
      row.balance.toFixed(2),
    ]),
  );

  const yearSlug = report.academicYearName ?? "current";
  const viewSlug = showAll ? "all" : "outstanding";

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
          <h1 className="text-2xl font-bold">Fee balances</h1>
          <p className="text-muted-foreground">
            Blessed Faith Academy · academic year
            {report.academicYearName ? ` ${report.academicYearName}` : ""}.
            Charges minus completed payments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <DownloadCsvButton
            filename={`fee-balances-${yearSlug}-${viewSlug}.csv`}
            csv={csv}
          />
          <PrintReportButton />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Link
          href="/dashboard/reports/fee-balances"
          className={buttonVariants({
            variant: showAll ? "outline" : "default",
            size: "sm",
          })}
        >
          Outstanding only
        </Link>
        <Link
          href="/dashboard/reports/fee-balances?view=all"
          className={buttonVariants({
            variant: showAll ? "default" : "outline",
            size: "sm",
          })}
        >
          All enrolled
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total charged</CardDescription>
            <CardTitle className="text-xl">
              {formatKwacha(report.totals.charged)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total paid</CardDescription>
            <CardTitle className="text-xl">
              {formatKwacha(report.totals.paid)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Outstanding</CardDescription>
            <CardTitle className="text-xl text-destructive">
              {formatKwacha(report.totals.balance)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {showAll ? "All enrolled students" : "Students with a balance"}
          </CardTitle>
          <CardDescription>{report.rows.length} shown</CardDescription>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {showAll
                ? "No enrolled students found."
                : "No outstanding balances — everyone is paid up (or has no charges yet)."}
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Charged</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.studentId}>
                      <TableCell>
                        <Link
                          href={`/dashboard/students/${row.studentId}`}
                          className="font-medium hover:underline"
                        >
                          {row.fullName}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {row.admissionNumber}
                        </p>
                      </TableCell>
                      <TableCell>{row.className ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {formatKwacha(row.totalCharged)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatKwacha(row.totalPaid)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          row.balance > 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatKwacha(row.balance)}
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
