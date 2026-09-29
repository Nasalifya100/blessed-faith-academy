import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordTransferForm } from "@/features/finance/components/record-transfer-form";
import { getFinancialAccountSummary } from "@/features/finance/queries";
import { FINANCIAL_ACCOUNT_TYPE_LABELS } from "@/features/finance/schemas";
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

export default async function FinanceAccountsPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW")) {
    redirect("/dashboard");
  }

  const { accounts, unassignedReceipts } = await getFinancialAccountSummary();
  const canTransfer = hasFinanceCapability(role, "FINANCE_TRANSFER_RECORD");
  const totalHeld = accounts
    .filter((account) => account.isActive)
    .reduce((sum, account) => sum + account.currentBalance, 0);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Accounts"
        description="Where the school's money is physically held. Each balance is the opening balance at the cutover date, plus later movements, plus receipts that name that account. A payment method is not an account."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={canTransfer ? <RecordTransferForm accounts={accounts} /> : null}
      />

      <FinanceNav role={role} current="/dashboard/finance/accounts" />

      {accounts.some((account) => !account.openingBalanceDate) ? (
        <p className="text-sm text-muted-foreground">
          An account without an opening-balance date is not cut over. Set that
          date and the real balance before recording new money, or historical
          cash and later receipts will not meet.
        </p>
      ) : null}
      {unassignedReceipts.count > 0 ? (
        <p className="text-sm text-muted-foreground">
          {unassignedReceipts.count} completed{" "}
          {unassignedReceipts.count === 1 ? "receipt is" : "receipts are"} not
          assigned to an account (
          {formatKwacha(unassignedReceipts.amount)}). They are excluded from
          every balance. If they were received on or before an opening-balance
          date, they are already inside that opening balance — do not add them
          again.
        </p>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Balances</CardTitle>
          <CardDescription>
            Total held across active accounts: {formatKwacha(totalHeld)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Current balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/finance/accounts/${account.id}`}
                      className="font-medium hover:underline"
                    >
                      {account.name}
                    </Link>
                    {!account.isActive ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (inactive)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {FINANCIAL_ACCOUNT_TYPE_LABELS[account.accountType]}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {account.maskedReference ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatKwacha(account.openingBalance)}
                  </TableCell>
                  <TableCell
                    className={
                      account.currentBalance >= 0
                        ? "text-right tabular-nums"
                        : "text-right tabular-nums text-red-700 dark:text-red-300"
                    }
                  >
                    {formatKwacha(account.currentBalance)}
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
