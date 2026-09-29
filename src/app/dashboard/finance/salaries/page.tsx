import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import {
  RecordSalaryForm,
  SalaryRowActions,
} from "@/features/finance/components/salary-forms";
import {
  getFinancialAccounts,
  getSalaryPayments,
  getStaffOptions,
} from "@/features/finance/queries";
import { SALARY_STATUS_LABELS } from "@/features/finance/schemas";
import type { SalaryPaymentStatus } from "@/features/finance/types";
import { formatKwacha } from "@/lib/money";
import { BackLink, PageHeader, PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
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

const STATUS_TONE: Record<
  SalaryPaymentStatus,
  "secondary" | "info" | "success" | "destructive"
> = {
  draft: "secondary",
  approved: "info",
  paid: "success",
  reversed: "destructive",
};

export default async function FinanceSalariesPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  // Salary visibility is enforced again by RLS; this only avoids rendering an
  // empty page to someone who should not see the area at all.
  if (!hasFinanceCapability(role, "FINANCE_SALARY_VIEW")) {
    redirect("/dashboard");
  }

  const canRecord = hasFinanceCapability(role, "FINANCE_SALARY_RECORD");
  const canApprove = hasFinanceCapability(role, "FINANCE_SALARY_APPROVE");
  const canPay = hasFinanceCapability(role, "FINANCE_SALARY_PAY");
  const canReverse = hasFinanceCapability(role, "FINANCE_REVERSE");

  const [salaries, accounts, staff] = await Promise.all([
    getSalaryPayments(200),
    getFinancialAccounts(),
    canRecord ? getStaffOptions() : Promise.resolve([]),
  ]);

  const paidTotal = salaries
    .filter((salary) => salary.status === "paid")
    .reduce((sum, salary) => sum + salary.netAmount, 0);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Salaries"
        description="Tracking of what the school pays its staff. This is a financial record, not a statutory payroll calculation. The bursar can see individual salaries because they pay them, and cannot approve them. The headteacher approves. Teachers and the secretary cannot see salary records."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={canRecord ? <RecordSalaryForm staff={staff} /> : null}
      />

      <FinanceNav role={role} current="/dashboard/finance/salaries" />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Salary records</CardTitle>
          <CardDescription>
            {formatKwacha(paidTotal)} paid across {salaries.length} record
            {salaries.length === 1 ? "" : "s"} shown. One live record is allowed
            per staff member per pay period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {salaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No salary records yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff member</TableHead>
                  <TableHead>Pay period</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaries.map((salary) => (
                  <TableRow key={salary.id}>
                    <TableCell className="font-medium">
                      {salary.staffName ?? "Unknown"}
                    </TableCell>
                    <TableCell>
                      {salary.periodLabel}
                      {salary.paymentDate ? (
                        <span className="block text-xs text-muted-foreground">
                          Paid {salary.paymentDate}
                          {salary.accountName ? ` from ${salary.accountName}` : ""}
                        </span>
                      ) : null}
                      {salary.reversalReason ? (
                        <span className="block text-xs text-muted-foreground">
                          Reversed: {salary.reversalReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(salary.grossAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(salary.deductionsAmount)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatKwacha(salary.netAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[salary.status]}>
                        {SALARY_STATUS_LABELS[salary.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <SalaryRowActions
                        salary={salary}
                        accounts={accounts}
                        canApprove={canApprove}
                        canPay={canPay}
                        canReverse={canReverse}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
