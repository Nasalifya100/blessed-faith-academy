import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
import {
  getFinanceOverview,
  getFundPositions,
  getLedgerEntries,
} from "@/features/finance/queries";
import { formatKwacha } from "@/lib/money";
import { BackLink, PageHeader, PageShell } from "@/components/layout/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_REPORTS_VIEW")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const from = firstValue(params.from) || null;
  const to = firstValue(params.to) || null;

  const [overview, funds, entries] = await Promise.all([
    getFinanceOverview(from, to),
    getFundPositions(from, to),
    getLedgerEntries({ from, to, limit: 500 }),
  ]);

  // Salary detail is never included in a general export, even for a caller
  // who can see it elsewhere.
  const exportable = entries.filter((entry) => entry.sourceType !== "salary");

  const fundCsv = toCsv(
    ["Fund", "From students", "Other income", "Total income", "Expenditure", "Net"],
    funds.map((fund) => [
      fund.name,
      fund.studentIncome.toFixed(2),
      fund.otherIncome.toFixed(2),
      fund.totalIncome.toFixed(2),
      fund.totalExpenditure.toFixed(2),
      fund.netPosition.toFixed(2),
    ]),
  );

  const transactionCsv = toCsv(
    ["Date", "Type", "Fund", "Account", "Description", "Reference", "Amount"],
    exportable.map((entry) => [
      entry.entryDate,
      entry.entryType,
      entry.fundName ?? "",
      entry.accountName ?? "",
      entry.description,
      entry.reference ?? "",
      entry.accountDelta.toFixed(2),
    ]),
  );

  const periodSlug = `${from ?? "start"}-to-${to ?? "today"}`;

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Financial reports"
        description="Filter by date, then read or export. Salary detail is excluded from general exports and is available only in the Salaries area."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <DownloadCsvButton
              filename={`fund-positions-${periodSlug}.csv`}
              csv={fundCsv}
            />
            <PrintReportButton />
          </div>
        }
      />

      <FinanceNav role={role} current="/dashboard/finance/reports" />

      <Card className="shadow-sm print:hidden">
        <CardHeader>
          <CardTitle>Period</CardTitle>
          <CardDescription>
            Leave both dates empty to report on everything recorded so far.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="space-y-1.5">
              <Label htmlFor="report-from">From</Label>
              <Input
                id="report-from"
                name="from"
                type="date"
                defaultValue={from ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-to">To</Label>
              <Input
                id="report-to"
                name="to"
                type="date"
                defaultValue={to ?? ""}
              />
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
            <Link
              href="/dashboard/finance/reports"
              className="text-sm text-muted-foreground hover:underline"
            >
              Clear
            </Link>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Income and expenditure by fund</CardTitle>
          <CardDescription>
            Total income {formatKwacha(overview?.totalIncome ?? 0)} · total
            expenditure {formatKwacha(overview?.totalExpenditure ?? 0)}.
            Transfers between the school&apos;s own accounts are excluded from
            both figures.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fund</TableHead>
                <TableHead className="text-right">From students</TableHead>
                <TableHead className="text-right">Other income</TableHead>
                <TableHead className="text-right">Expenditure</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funds.map((fund) => (
                <TableRow key={fund.id}>
                  <TableCell>{fund.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.studentIncome)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.otherIncome)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.totalExpenditure)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.netPosition)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            {exportable.length} transaction
            {exportable.length === 1 ? "" : "s"} in this period, excluding
            salary detail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="print:hidden">
            <DownloadCsvButton
              filename={`finance-transactions-${periodSlug}.csv`}
              csv={transactionCsv}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Fund</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exportable.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="tabular-nums">
                    {entry.entryDate}
                  </TableCell>
                  <TableCell className="max-w-[24rem] whitespace-normal">
                    {entry.description}
                  </TableCell>
                  <TableCell>{entry.fundName ?? "—"}</TableCell>
                  <TableCell>{entry.accountName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.accountDelta >= 0 ? "+" : "−"}
                    {formatKwacha(Math.abs(entry.accountDelta))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
