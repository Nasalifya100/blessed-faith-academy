import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  hasFinanceCapability,
} from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordIncomeForm } from "@/features/finance/components/record-income-form";
import {
  getFinancialAccounts,
  getFundPositions,
} from "@/features/finance/queries";
import { activityHref } from "@/features/finance/presentation";
import { formatKwacha } from "@/lib/money";
import { BackLink, PageHeader, PageShell } from "@/components/layout/page-shell";
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

export default async function FinanceFundsPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_FUNDS_VIEW")) {
    redirect("/dashboard");
  }

  const canRecordIncome = hasFinanceCapability(role, "FINANCE_LEDGER_RECORD");
  const canSeeAccounts = hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW");

  const [funds, accounts] = await Promise.all([
    getFundPositions(),
    canSeeAccounts ? getFinancialAccounts() : Promise.resolve([]),
  ]);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Funds"
        description="Each fund tracks one school activity: what it brought in, what it cost, and where it stands. A fund is not a bank account."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={
          canRecordIncome && canSeeAccounts ? (
            <RecordIncomeForm
              funds={funds.map((fund) => ({
                id: fund.id,
                code: fund.code,
                name: fund.name,
                description: fund.description,
                isSchoolFees: fund.isSchoolFees,
                isActive: fund.isActive,
                sortOrder: fund.sortOrder,
              }))}
              accounts={accounts}
            />
          ) : null
        }
      />

      <FinanceNav role={role} current="/dashboard/finance/funds" />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Fund positions</CardTitle>
          <CardDescription>
            Income includes receipted student payments attributed to the fund
            plus any other money recorded against it.
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
                <TableHead className="text-right">Net position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funds.map((fund) => (
                <TableRow key={fund.id}>
                  <TableCell>
                    <Link
                      href={activityHref(fund.code)}
                      className="font-medium hover:underline"
                    >
                      {fund.name}
                    </Link>
                    {!fund.isActive ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (inactive)
                      </span>
                    ) : null}
                    {fund.description ? (
                      <span className="block max-w-md whitespace-normal text-xs text-muted-foreground">
                        {fund.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.studentIncome)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.otherIncome)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(fund.totalExpenditure)}
                  </TableCell>
                  <TableCell
                    className={
                      fund.netPosition >= 0
                        ? "text-right tabular-nums text-emerald-700 dark:text-emerald-300"
                        : "text-right tabular-nums text-red-700 dark:text-red-300"
                    }
                  >
                    {formatKwacha(fund.netPosition)}
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
