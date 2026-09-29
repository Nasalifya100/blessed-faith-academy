import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeftRight,
  Banknote,
  ClipboardCheck,
  Landmark,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenFinance, hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { TransactionTable } from "@/features/finance/components/transaction-table";
import {
  getFinanceOverview,
  getLedgerEntries,
} from "@/features/finance/queries";
import { formatKwacha } from "@/lib/money";
import { PageHeader, PageShell, SectionHeading } from "@/components/layout/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function FinanceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!canOpenFinance(role)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const from = firstValue(params.from) || null;
  const to = firstValue(params.to) || null;

  const overview = await getFinanceOverview(from, to);
  const canSeeAccounts = hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW");
  const recent = canSeeAccounts
    ? await getLedgerEntries({ from, to, limit: 15 })
    : [];

  if (!overview) {
    return (
      <PageShell>
        <PageHeader eyebrow="Finance" title="Finance overview" />
        <EmptyState
          title="Finance data is unavailable"
          description="The finance summary could not be loaded. Check your connection and try again."
          icon={<Wallet className="size-6 text-muted-foreground" aria-hidden />}
        />
      </PageShell>
    );
  }

  const netPosition = overview.totalIncome - overview.totalExpenditure;

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Finance overview"
        description={
          <>
            Money the school has earned, spent, and currently holds. Funds
            answer <strong>what the money is for</strong>; accounts answer{" "}
            <strong>where it is kept</strong>. Transfers between the school&apos;s
            own accounts are counted as neither income nor expenditure.
          </>
        }
      />

      <FinanceNav role={role} current="/dashboard/finance" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Income"
          value={formatKwacha(overview.totalIncome)}
          hint="All funds, excluding transfers"
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          title="Expenditure"
          value={formatKwacha(overview.totalExpenditure)}
          hint="Paid expenses and salaries"
          icon={TrendingDown}
          tone={overview.totalExpenditure > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Net position"
          value={formatKwacha(netPosition)}
          hint="Income less expenditure"
          icon={Banknote}
          tone={netPosition >= 0 ? "success" : "danger"}
        />
        <StatCard
          title="Outstanding school fees"
          value={formatKwacha(overview.outstandingSchoolFees)}
          hint="Mandatory school fees only. The fee balances report is the combined student account, which is larger when uniforms or meals are unpaid."
          icon={ClipboardCheck}
          tone={overview.outstandingSchoolFees > 0 ? "warning" : "success"}
        />
      </div>

      {canSeeAccounts ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            title="Money held"
            value={formatKwacha(overview.totalHeld)}
            hint="Across all active accounts"
            icon={Landmark}
            href="/dashboard/finance/accounts"
          />
          <StatCard
            title="Transfers recorded"
            value={formatKwacha(overview.transfersTotal)}
            hint="Moved between the school's own accounts"
            icon={ArrowLeftRight}
            href="/dashboard/finance/transfers"
          />
          <StatCard
            title="Awaiting approval or payment"
            value={formatKwacha(overview.pendingExpenses.amount)}
            hint={`${overview.pendingExpenses.count} expense${overview.pendingExpenses.count === 1 ? "" : "s"} not yet paid`}
            icon={PiggyBank}
            tone={overview.pendingExpenses.count > 0 ? "info" : "default"}
            href="/dashboard/finance/expenses"
          />
        </div>
      ) : null}

      {overview.funds.length > 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Income by fund</CardTitle>
            <CardDescription>
              What each school activity brought in and what it cost to run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fund</TableHead>
                  <TableHead className="text-right">Income</TableHead>
                  <TableHead className="text-right">Expenditure</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.funds
                  .filter((fund) => fund.isActive)
                  .map((fund) => (
                    <TableRow key={fund.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/finance/funds/${fund.code.toLowerCase()}`}
                          className="font-medium hover:underline"
                        >
                          {fund.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatKwacha(fund.totalIncome)}
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
      ) : null}

      {canSeeAccounts ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Where the money is held</CardTitle>
            <CardDescription>
              These are physical balances, not fund positions. A fund balance
              is never the same thing as cash in the bank.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.accounts
                  .filter((account) => account.isActive)
                  .map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/finance/accounts/${account.id}`}
                          className="font-medium hover:underline"
                        >
                          {account.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {account.accountType.replace("_", " ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatKwacha(account.currentBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>

            <div className="space-y-3">
              <SectionHeading
                title="Recent transactions"
                description="The latest money movements outside student fee receipts."
              />
              <TransactionTable entries={recent} />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
