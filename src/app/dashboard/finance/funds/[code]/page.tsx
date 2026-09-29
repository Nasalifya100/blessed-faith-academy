import { notFound, redirect } from "next/navigation";
import { Coins, TrendingDown, TrendingUp } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { TransactionTable } from "@/features/finance/components/transaction-table";
import {
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
import { StatCard } from "@/components/ui/stat-card";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function FundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_FUNDS_VIEW")) {
    redirect("/dashboard");
  }

  const { code } = await params;
  const normalized = code.toUpperCase();
  if (
    normalized === "TUCK_SHOP" ||
    normalized === "UNIFORMS" ||
    normalized === "MEALS"
  ) {
    redirect(`/dashboard/finance/${normalized === "TUCK_SHOP" ? "tuck-shop" : normalized.toLowerCase()}`);
  }
  const search = await searchParams;
  const from = firstValue(search.from) || null;
  const to = firstValue(search.to) || null;

  const funds = await getFundPositions(from, to);
  const fund = funds.find(
    (candidate) => candidate.code.toLowerCase() === code.toLowerCase(),
  );
  if (!fund) notFound();

  const entries = hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW")
    ? await getLedgerEntries({ fundId: fund.id, from, to, limit: 200 })
    : [];

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance · Fund"
        title={fund.name}
        description={
          fund.isSchoolFees
            ? "Mandatory school fees. This net position is not cash in the bank. Student income is taken only from payment allocations."
            : `${fund.description ?? "Income and costs for this school activity."} This net position is not cash in the bank.`
        }
        breadcrumb={
          <BackLink href="/dashboard/finance/funds">Back to funds</BackLink>
        }
      />

      <FinanceNav role={role} current="/dashboard/finance/funds" />

      {!fund.allocationsActive ? (
        <p className="text-sm text-muted-foreground">
          Student income on this page counts only payments that have been
          allocated to a charge. Until allocations are switched on, older
          receipts are not included here, and they are not guessed.
        </p>
      ) : null}
      {fund.salaryCostsOmitted ? (
        <p className="text-sm text-muted-foreground">
          Salary costs are omitted from this view. Individual salaries are
          visible only to the bursar, the headteacher, and the administrator.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Income"
          value={formatKwacha(fund.totalIncome)}
          hint={`${formatKwacha(fund.studentIncome)} from students · ${formatKwacha(fund.otherIncome)} other`}
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          title="Expenditure"
          value={formatKwacha(fund.totalExpenditure)}
          hint="Paid costs charged to this fund"
          icon={TrendingDown}
          tone={fund.totalExpenditure > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Net position"
          value={formatKwacha(fund.netPosition)}
          hint="Income less expenditure. This is not cash in the bank."
          icon={Coins}
          tone={fund.netPosition >= 0 ? "success" : "danger"}
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            Money recorded directly against this fund. Receipted student
            payments appear on the student&apos;s own statement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionTable
            entries={entries}
            showFund={false}
            emptyMessage="No transactions recorded against this fund yet."
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
