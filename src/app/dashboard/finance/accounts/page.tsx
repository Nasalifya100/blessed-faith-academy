import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordTransferForm } from "@/features/finance/components/record-transfer-form";
import { getFinancialAccountSummary } from "@/features/finance/queries";
import { FINANCIAL_ACCOUNT_TYPE_LABELS } from "@/features/finance/schemas";
import {
  moneyHeldReady,
  openingBalanceConfigured,
  openingBalanceSetupBlocked,
} from "@/features/finance/presentation";
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
        title="Money held"
        description="Where the school's money is physically held: bank, mobile money, and petty cash. These balances are not fund positions. A payment method is not an account."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={canTransfer ? <RecordTransferForm accounts={accounts} /> : null}
      />

      <FinanceNav role={role} current="/dashboard/finance/accounts" />

      {accounts.some((account) => openingBalanceSetupBlocked(account)) ? (
        <p className="text-sm text-muted-foreground">
          An account that already has an assigned receipt or another movement
          cannot receive an opening balance. The cash total stays hidden until
          that is resolved. Do not treat the portal receipt history as the
          amount still held.
        </p>
      ) : accounts.some((account) => !account.openingBalanceDate) ? (
        <p className="text-sm text-muted-foreground">
          An account without an opening-balance date is not cut over. Enter the
          actual amount held at the end of one agreed date. Transactions on
          that date are already inside the figure. Transactions after it are
          added or subtracted automatically.
        </p>
      ) : null}
      {unassignedReceipts.count > 0 ? (
        <p className="text-sm text-muted-foreground">
          {unassignedReceipts.count} completed{" "}
          {unassignedReceipts.count === 1 ? "receipt is" : "receipts are"} not
          assigned to an account (
          {formatKwacha(unassignedReceipts.amount)}). They remain valid student
          receipts and stay out of Bank, Mobile Money, and Petty Cash. Do not
          assign them from here. If that cash is physically in an account,
          include it once in that account&apos;s end-of-day opening balance.
        </p>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Balances</CardTitle>
          <CardDescription>
            {moneyHeldReady(accounts)
              ? `Total money held: ${formatKwacha(totalHeld)}`
              : "Opening balance required on every active account before a total is shown."}
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
                    {openingBalanceConfigured(account)
                      ? formatKwacha(account.openingBalance)
                      : "Opening balance required"}
                  </TableCell>
                  <TableCell
                    className={
                      !openingBalanceConfigured(account)
                        ? "text-right text-muted-foreground"
                        : account.currentBalance >= 0
                          ? "text-right tabular-nums"
                          : "text-right tabular-nums text-red-700 dark:text-red-300"
                    }
                  >
                    {openingBalanceConfigured(account)
                      ? formatKwacha(account.currentBalance)
                      : "Opening balance required"}
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
