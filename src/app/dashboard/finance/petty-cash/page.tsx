import { redirect } from "next/navigation";
import { Coins } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordExpenseForm } from "@/features/finance/components/record-expense-form";
import { RecordTransferForm } from "@/features/finance/components/record-transfer-form";
import { TransactionTable } from "@/features/finance/components/transaction-table";
import {
  getExpenseCategories,
  getFinancialAccounts,
  getFunds,
  getLedgerEntries,
} from "@/features/finance/queries";
import {
  moneyHeldReady,
  openingBalanceConfigured,
  primaryPettyCashAccount,
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
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

export default async function PettyCashPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW")) {
    redirect("/dashboard");
  }

  const canTransfer = hasFinanceCapability(role, "FINANCE_TRANSFER_RECORD");
  const canRecordExpense = hasFinanceCapability(role, "FINANCE_EXPENSE_RECORD");

  const [accounts, funds, categories] = await Promise.all([
    getFinancialAccounts(),
    canRecordExpense ? getFunds() : Promise.resolve([]),
    canRecordExpense ? getExpenseCategories() : Promise.resolve([]),
  ]);
  const pettyCash = accounts.filter(
    (account) => account.accountType === "petty_cash",
  );

  if (pettyCash.length === 0) {
    return (
      <PageShell width="wide">
        <PageHeader
          eyebrow="Finance"
          title="Petty cash"
          breadcrumb={
            <BackLink href="/dashboard/finance">Back to finance</BackLink>
          }
        />
        <FinanceNav role={role} current="/dashboard/finance/petty-cash" />
        <EmptyState
          title="No petty cash account"
          description="An administrator needs to create the petty cash account before cash can be recorded."
          icon={<Coins className="size-6 text-muted-foreground" aria-hidden />}
        />
      </PageShell>
    );
  }

  const primary = primaryPettyCashAccount(pettyCash) ?? pettyCash[0];
  const entriesByAccount = await Promise.all(
    pettyCash.map(async (account) => ({
      account,
      entries: await getLedgerEntries({ accountId: account.id, limit: 200 }),
    })),
  );
  const balanceReady = moneyHeldReady(pettyCash);
  const totalFloat = pettyCash
    .filter((account) => account.isActive)
    .reduce((sum, account) => sum + account.currentBalance, 0);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Petty cash"
        description="Cash held at the school. Adding money from the bank or mobile money is a transfer: income stays K0 and expenses stay K0. Spending the cash is an expense."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
      />

      <FinanceNav role={role} current="/dashboard/finance/petty-cash" />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {canTransfer ? (
          <RecordTransferForm
            accounts={accounts}
            pettyCashTopUp
            buttonLabel="Add money"
            submitLabel="Add money"
            defaultDescription="Petty cash top-up"
          />
        ) : null}
        {canRecordExpense ? (
          <RecordExpenseForm
            categories={categories}
            funds={funds}
            accounts={accounts}
            pettyCash
            buttonLabel="Record Expense"
            submitLabel="Record Expense"
            formLabel="Petty cash expense"
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Current petty cash balance"
          value={
            balanceReady ? formatKwacha(totalFloat) : "Opening balance required"
          }
          hint={
            openingBalanceConfigured(primary)
              ? primary.name
              : "Set the opening balance before treating this as cash on hand"
          }
          icon={Coins}
          tone={balanceReady && totalFloat < 0 ? "danger" : "default"}
        />
      </div>

      {entriesByAccount.map(({ account, entries }) => {
        const moneyIn = entries
          .filter((entry) => entry.entryType === "transfer_in" && !entry.reversedAt)
          .reduce((sum, entry) => sum + entry.amount, 0);
        const moneyOut = entries
          .filter((entry) => entry.entryType === "expense" && !entry.reversedAt)
          .reduce((sum, entry) => sum + entry.amount, 0);

        return (
          <Card key={account.id} className="shadow-sm">
            <CardHeader>
              <CardTitle>{account.name}</CardTitle>
              <CardDescription>
                {openingBalanceConfigured(account)
                  ? `Balance ${formatKwacha(account.currentBalance)}`
                  : "Opening balance required"}
                {" · "}
                Money in {formatKwacha(moneyIn)}
                {" · "}
                Money out {formatKwacha(moneyOut)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <EmptyState
                  title="No petty cash movements yet."
                  description="Add money from the bank, or record an expense paid from this cash."
                />
              ) : (
                <TransactionTable
                  entries={entries}
                  showAccount={false}
                  emptyMessage="No petty cash movements recorded yet."
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </PageShell>
  );
}
