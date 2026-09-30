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
import {
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
  const cutoverReady = openingBalanceConfigured(account);
  const setupBlocked = openingBalanceSetupBlocked(account);
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
          value={
            cutoverReady
              ? formatKwacha(account.openingBalance)
              : "Opening balance required"
          }
          hint={
            cutoverReady
              ? `Actual balance at the end of ${account.openingBalanceDate}`
              : "No cutover date recorded"
          }
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
          value={
            cutoverReady
              ? formatKwacha(account.currentBalance)
              : "Opening balance required"
          }
          hint={
            cutoverReady
              ? "Opening balance, plus receipts and movements after that date"
              : "Withheld until the end-of-day cutover balance is entered"
          }
          icon={Landmark}
          tone={
            cutoverReady && account.currentBalance < 0 ? "danger" : "default"
          }
        />
      </div>

      {cutoverReady ? (
        <p className="text-sm text-muted-foreground">
          Opening {formatKwacha(account.openingBalance)} at the end of{" "}
          {account.openingBalanceDate}
          {" + "}
          receipts after that date {formatKwacha(account.assignedReceipts)}
          {" + "}
          transfers and other movements after that date{" "}
          {formatKwacha(account.ledgerMovement)}
          {" = "}
          {formatKwacha(account.currentBalance)}.
          {account.currentBalance < 0
            ? " This balance is below zero. It is shown as recorded and is not corrected automatically."
            : ""}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Current balance is withheld. Enter the actual amount held at the end
          of the cutover date before this account is treated as money on hand.
          {setupBlocked
            ? " Assigned receipts or movements already exist, so that entry is blocked."
            : ""}
        </p>
      )}

      {canSetOpening ? (
        <SetOpeningBalanceForm account={account} blocked={setupBlocked} />
      ) : null}

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
