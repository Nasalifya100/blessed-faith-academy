import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { ExpenseRowActions } from "@/features/finance/components/expense-row-actions";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordExpenseForm } from "@/features/finance/components/record-expense-form";
import {
  getExpenseCategories,
  getExpenses,
  getFinancialAccounts,
  getFunds,
} from "@/features/finance/queries";
import { EXPENSE_STATUS_LABELS } from "@/features/finance/schemas";
import type { ExpenseStatus } from "@/features/finance/types";
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
  ExpenseStatus,
  "secondary" | "info" | "success" | "destructive"
> = {
  recorded: "secondary",
  approved: "info",
  paid: "success",
  reversed: "destructive",
};

export default async function FinanceExpensesPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_EXPENSE_RECORD")) {
    redirect("/dashboard");
  }

  const [expenses, categories, funds, accounts] = await Promise.all([
    getExpenses({ limit: 200 }),
    getExpenseCategories(),
    getFunds(),
    getFinancialAccounts(),
  ]);

  const canApprove = hasFinanceCapability(role, "FINANCE_EXPENSE_APPROVE");
  const canPay = hasFinanceCapability(role, "FINANCE_EXPENSE_PAY");
  const canReverse = hasFinanceCapability(role, "FINANCE_REVERSE");

  const paidTotal = expenses
    .filter((expense) => expense.status === "paid")
    .reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Expenses"
        description="Everything the school spends. An expense is recorded, then approved, then paid — and only payment reduces an account balance."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={
          <RecordExpenseForm
            categories={categories}
            funds={funds}
            accounts={accounts}
          />
        }
      />

      <FinanceNav role={role} current="/dashboard/finance/expenses" />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Expense records</CardTitle>
          <CardDescription>
            {formatKwacha(paidTotal)} paid across {expenses.length} record
            {expenses.length === 1 ? "" : "s"} shown. Posted expenses are never
            deleted — use Reverse to correct one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No expenses recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Fund</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="tabular-nums">
                      {expense.expenseDate}
                    </TableCell>
                    <TableCell className="max-w-[20rem] whitespace-normal">
                      <span
                        className={
                          expense.status === "reversed"
                            ? "line-through"
                            : undefined
                        }
                      >
                        {expense.description}
                      </span>
                      {expense.payee ? (
                        <span className="block text-xs text-muted-foreground">
                          {expense.payee}
                        </span>
                      ) : null}
                      {expense.reversalReason ? (
                        <span className="block text-xs text-muted-foreground">
                          Reversed: {expense.reversalReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{expense.categoryName ?? "—"}</TableCell>
                    <TableCell>{expense.fundName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(expense.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[expense.status]}>
                        {EXPENSE_STATUS_LABELS[expense.status]}
                      </Badge>
                      {expense.selfApproved ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Self-approved
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <ExpenseRowActions
                        expense={expense}
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
