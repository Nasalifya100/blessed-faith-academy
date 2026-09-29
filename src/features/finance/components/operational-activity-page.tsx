import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Coins, TrendingDown, TrendingUp } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordExpenseForm } from "@/features/finance/components/record-expense-form";
import { RecordIncomeForm } from "@/features/finance/components/record-income-form";
import { TransactionTable } from "@/features/finance/components/transaction-table";
import {
  getExpenseCategories,
  getFinancialAccounts,
  getFundPositions,
  getFunds,
  getLedgerEntries,
} from "@/features/finance/queries";
import {
  ACTIVITY_RECENT_LIMIT,
  activityEmptyDescription,
  lusakaDate,
  monthStart,
  type OperationalActivity,
} from "@/features/finance/presentation";
import { formatKwacha } from "@/lib/money";
import { PageHeader, PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import type { FundPosition } from "@/features/finance/types";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function findFund(
  funds: readonly FundPosition[],
  code: string,
): FundPosition | undefined {
  return funds.find((fund) => fund.code.toUpperCase() === code.toUpperCase());
}

export async function OperationalActivityPage({
  activity,
  searchParams,
}: {
  activity: OperationalActivity;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_FUNDS_VIEW")) {
    redirect("/dashboard");
  }

  const search = await searchParams;
  const from = firstValue(search.from) || null;
  const to = firstValue(search.to) || null;
  const today = lusakaDate();
  const monthFrom = monthStart(today);

  const canRecordIncome = hasFinanceCapability(role, "FINANCE_LEDGER_RECORD");
  const canRecordExpense = hasFinanceCapability(role, "FINANCE_EXPENSE_RECORD");
  const canSeeAccounts = hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW");

  const [allFunds, todayFunds, monthFunds, accounts, categories, fundList] =
    await Promise.all([
      getFundPositions(),
      getFundPositions(today, today),
      getFundPositions(monthFrom, today),
      canSeeAccounts ? getFinancialAccounts() : Promise.resolve([]),
      canRecordExpense ? getExpenseCategories() : Promise.resolve([]),
      canRecordIncome || canRecordExpense ? getFunds() : Promise.resolve([]),
    ]);

  const fund = findFund(allFunds, activity.code);
  if (!fund) notFound();

  const todayPosition = findFund(todayFunds, activity.code);
  const monthPosition = findFund(monthFunds, activity.code);
  const entries = canSeeAccounts
    ? await getLedgerEntries({
        fundId: fund.id,
        from,
        to,
        limit: ACTIVITY_RECENT_LIMIT,
      })
    : [];

  const fundOptions = fundList.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    isSchoolFees: item.isSchoolFees,
    isActive: item.isActive,
    sortOrder: item.sortOrder,
  }));

  const hasActivity =
    fund.totalIncome > 0 || fund.totalExpenditure > 0 || entries.length > 0;

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={activity.eyebrow}
        title={activity.title}
        description={activity.summary}
      />

      <FinanceNav role={role} current={activity.href} />

      {canRecordIncome || canRecordExpense ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canRecordIncome && canSeeAccounts ? (
            <RecordIncomeForm
              funds={fundOptions}
              accounts={accounts}
              activityCode={activity.code}
              buttonLabel={activity.incomeButton}
              submitLabel={activity.incomeSubmit}
              formLabel={activity.incomeButton}
              defaultDescription={activity.defaultDescription}
            />
          ) : null}
          {canRecordExpense && canSeeAccounts ? (
            <RecordExpenseForm
              categories={categories}
              funds={fundOptions}
              accounts={accounts}
              activityCode={activity.code}
              suggestedCategoryCode={activity.suggestedCategoryCode}
              buttonLabel={activity.expenseButton}
              submitLabel={activity.expenseButton}
              formLabel={`${activity.title} expense`}
            />
          ) : null}
        </div>
      ) : null}

      {!hasActivity ? (
        <EmptyState
          title={activity.emptyTitle}
          description={activityEmptyDescription(
            activity,
            canRecordIncome && canSeeAccounts,
          )}
          icon={<Coins className="size-6 text-muted-foreground" aria-hidden />}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Today — income"
          value={formatKwacha(todayPosition?.totalIncome ?? 0)}
          hint={today}
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          title="Today — expenses"
          value={formatKwacha(todayPosition?.totalExpenditure ?? 0)}
          hint="Paid costs only"
          icon={TrendingDown}
        />
        <StatCard
          title="Today — net"
          value={formatKwacha(todayPosition?.netPosition ?? 0)}
          hint="Income less expenses. Not cash in hand."
          icon={Coins}
          tone={(todayPosition?.netPosition ?? 0) >= 0 ? "success" : "danger"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="This month — income"
          value={formatKwacha(monthPosition?.totalIncome ?? 0)}
          hint={`${monthFrom} to ${today}`}
          icon={TrendingUp}
        />
        <StatCard
          title="This month — expenses"
          value={formatKwacha(monthPosition?.totalExpenditure ?? 0)}
          icon={TrendingDown}
        />
        <StatCard
          title="This month — net"
          value={formatKwacha(monthPosition?.netPosition ?? 0)}
          hint="Not the same as money held in an account."
          icon={Coins}
        />
      </div>

      <form
        method="get"
        className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <div className="space-y-1">
          <label htmlFor={`${activity.code}-from`} className="text-sm font-medium">
            From
          </label>
          <input
            id={`${activity.code}-from`}
            name="from"
            type="date"
            defaultValue={from ?? ""}
            className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${activity.code}-to`} className="text-sm font-medium">
            To
          </label>
          <input
            id={`${activity.code}-to`}
            name="to"
            type="date"
            defaultValue={to ?? ""}
            className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium"
        >
          Show activity
        </button>
        {from || to ? (
          <Link href={activity.href} className="text-sm underline">
            Clear dates
          </Link>
        ) : null}
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        <p className="text-sm text-muted-foreground">
          Where the money was received or paid from is shown beside each row.
          Student fee receipts stay on the student statement.
        </p>
        {canSeeAccounts ? (
          <TransactionTable
            entries={entries}
            showFund={false}
            accountHeading="Where"
            emptyMessage={activity.emptyTitle}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Transaction detail is limited to staff who can see where money is held.
          </p>
        )}
      </div>
    </PageShell>
  );
}
