import { redirect } from "next/navigation";
import { Coins } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordTransferForm } from "@/features/finance/components/record-transfer-form";
import { TransactionTable } from "@/features/finance/components/transaction-table";
import {
  getFinancialAccounts,
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
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

export default async function PettyCashPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW")) {
    redirect("/dashboard");
  }

  const accounts = await getFinancialAccounts();
  const pettyCash = accounts.filter(
    (account) => account.accountType === "petty_cash",
  );
  const canTransfer = hasFinanceCapability(role, "FINANCE_TRANSFER_RECORD");

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
          description="Ask an administrator to create a petty cash account in Finance settings."
          icon={<Coins className="size-6 text-muted-foreground" aria-hidden />}
        />
      </PageShell>
    );
  }

  const entriesByAccount = await Promise.all(
    pettyCash.map(async (account) => ({
      account,
      entries: await getLedgerEntries({ accountId: account.id, limit: 200 }),
    })),
  );

  const totalFloat = pettyCash
    .filter((account) => account.isActive)
    .reduce((sum, account) => sum + account.currentBalance, 0);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Petty cash"
        description="The small cash float held at the school. Topping it up from the bank is a transfer, not an expense — the money only becomes expenditure when it is actually spent."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={canTransfer ? <RecordTransferForm accounts={accounts} /> : null}
      />

      <FinanceNav role={role} current="/dashboard/finance/petty-cash" />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title="Cash on hand"
          value={formatKwacha(totalFloat)}
          hint="Across all petty cash accounts"
          icon={Coins}
          tone={totalFloat >= 0 ? "default" : "danger"}
        />
      </div>

      {entriesByAccount.map(({ account, entries }) => {
        const toppedUp = entries
          .filter((entry) => entry.entryType === "transfer_in")
          .reduce((sum, entry) => sum + entry.accountDelta, 0);
        const spent = entries
          .filter((entry) => entry.entryType === "expense")
          .reduce((sum, entry) => sum + Math.abs(entry.accountDelta), 0);

        return (
          <Card key={account.id} className="shadow-sm">
            <CardHeader>
              <CardTitle>{account.name}</CardTitle>
              <CardDescription>
                Balance {formatKwacha(account.currentBalance)} ·{" "}
                {formatKwacha(toppedUp)} topped up · {formatKwacha(spent)} spent
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TransactionTable
                entries={entries}
                showAccount={false}
                emptyMessage="No petty cash movements recorded yet."
              />
            </CardContent>
          </Card>
        );
      })}
    </PageShell>
  );
}
