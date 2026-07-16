import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Banknote,
  Calculator,
  CircleDollarSign,
  Users,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getFeeBalancesReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
import { FeeBalancesReportTable } from "@/features/reports/components/fee-balances-report-table";
import { ReportFilterBar } from "@/features/reports/components/report-filter-bar";
import { formatKwacha } from "@/lib/money";
import {
  BackLink,
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

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

  const studentsOwing = report.totals.studentsWithBalance;
  const averageBalance =
    studentsOwing > 0 ? report.totals.balance / studentsOwing : 0;

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
    <PageShell>
      <PageHeader
        eyebrow="Reports"
        title="Fee balances"
        description={
          <>
            Blessed Faith Academy · academic year
            {report.academicYearName ? ` ${report.academicYearName}` : ""}.
            Charges minus completed payments.
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
              filename={`fee-balances-${yearSlug}-${viewSlug}.csv`}
              csv={csv}
            />
            <PrintReportButton />
          </div>
        }
      />

      <ReportFilterBar label="Balance view filters">
        <div className="flex flex-wrap gap-2" role="group" aria-label="View">
          <Link
            href="/dashboard/reports/fee-balances"
            className={cn(
              buttonVariants({
                variant: showAll ? "outline" : "default",
                size: "sm",
              }),
              "min-h-10",
            )}
            aria-current={!showAll ? "page" : undefined}
          >
            Outstanding only
          </Link>
          <Link
            href="/dashboard/reports/fee-balances?view=all"
            className={cn(
              buttonVariants({
                variant: showAll ? "default" : "outline",
                size: "sm",
              }),
              "min-h-10",
            )}
            aria-current={showAll ? "page" : undefined}
          >
            All enrolled
          </Link>
        </div>
      </ReportFilterBar>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total outstanding"
          value={formatKwacha(report.totals.balance)}
          hint="Sum of student balances"
          icon={CircleDollarSign}
          tone={report.totals.balance > 0 ? "danger" : "success"}
        />
        <StatCard
          title="Collected"
          value={formatKwacha(report.totals.paid)}
          hint="Completed payments in this view"
          icon={Banknote}
          tone="success"
        />
        <StatCard
          title="Students owing"
          value={String(studentsOwing)}
          hint={`${report.rows.length} row${report.rows.length === 1 ? "" : "s"} shown`}
          icon={Users}
          tone={studentsOwing > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Average balance"
          value={studentsOwing > 0 ? formatKwacha(averageBalance) : "K0"}
          hint="Among students with a balance"
          icon={Calculator}
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>
            {showAll ? "All enrolled students" : "Students with a balance"}
          </CardTitle>
          <CardDescription>
            Paid · Partial · Outstanding status is based on charged vs paid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <EmptyState
              title="No fee records"
              description={
                showAll
                  ? "No enrolled students found for the current year."
                  : "No outstanding balances — everyone is paid up (or has no charges yet)."
              }
              icon={
                <Wallet className="size-6 text-muted-foreground" aria-hidden />
              }
              size="sm"
            />
          ) : (
            <div className="space-y-3">
              <SectionHeading
                title="Balance detail"
                description="Search by name, admission number, or class."
              />
              <FeeBalancesReportTable rows={report.rows} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
