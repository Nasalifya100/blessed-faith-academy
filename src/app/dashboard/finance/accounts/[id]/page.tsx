import { notFound, redirect } from "next/navigation";
import { Landmark } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { SetOpeningBalanceForm } from "@/features/finance/components/set-opening-balance-form";
import { TransactionTable } from "@/features/finance/components/transaction-table";
import {
  getFinancialAccounts,
  getLedgerEntries,
} from "@/features/finance/queries";
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
import { StatCard } from "@/components/ui/stat-card";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const accounts = await getFinancialAccounts();
  const account = accounts.find((candidate) => candidate.id === id);
  if (!account) notFound();

  const canSetOpening = hasFinanceCapability(role, "FINANCE_SETUP_MANAGE");
  const entries = await getLedgerEntries({ accountId: account.id, limit: 200 });

  const movedIn = entries
    .filter((entry) => entry.accountDelta > 0)
    .reduce((sum, entry) => sum + entry.accountDelta, 0);
  const movedOut = entries
    .filter((entry) => entry.accountDelta < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.accountDelta), 0);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={`Finance · ${FINANCIAL_ACCOUNT_TYPE_LABELS[account.accountType]}`}
        title={account.name}
        description={
          account.description ??
          "Every movement in and out of this account, in date order."
        }
        breadcrumb={
          <BackLink href="/dashboard/finance/accounts">
            Back to accounts
          </BackLink>
        }
      />

      <FinanceNav role={role} current="/dashboard/finance/accounts" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Opening balance"
          value={formatKwacha(account.openingBalance)}
          hint={account.openingBalanceDate ?? "No start date recorded"}
        />
        <StatCard
          title="Money in"
          value={formatKwacha(movedIn)}
          hint="Recorded movements shown below"
          tone="success"
        />
        <StatCard
          title="Money out"
          value={formatKwacha(movedOut)}
          hint="Recorded movements shown below"
          tone="warning"
        />
        <StatCard
          title="Current balance"
          value={formatKwacha(account.currentBalance)}
          hint="Opening balance, plus later movements, plus receipts that name this account"
          icon={Landmark}
          tone={account.currentBalance >= 0 ? "default" : "danger"}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Opening {formatKwacha(account.openingBalance)}
        {account.openingBalanceDate
          ? ` at the end of ${account.openingBalanceDate}`
          : " (no cutover date yet)"}
        {" + "}
        receipts assigned to this account{" "}
        {formatKwacha(account.assignedReceipts)}
        {" + "}
        other movements {formatKwacha(account.ledgerMovement)}
        {" = "}
        {formatKwacha(account.currentBalance)}.
      </p>

      {canSetOpening ? <SetOpeningBalanceForm account={account} /> : null}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Account history</CardTitle>
          <CardDescription>
            Student receipts appear in the balance only when the receipt names
            this account and is dated after the opening balance. Receipts on or
            before that date are already inside the opening balance. A payment
            method is never used to guess the account. Negative balances are
            allowed so a late entry is not blocked; a balance below zero needs
            investigation before more money is spent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionTable
            entries={entries}
            showAccount={false}
            emptyMessage="No movements recorded for this account yet."
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
