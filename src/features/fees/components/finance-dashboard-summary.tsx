import Link from "next/link";
import {
  Banknote,
  FileDown,
  Printer,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";

import type { FeeBalancesReport } from "@/features/reports/queries";
import { formatKwacha } from "@/lib/money";
import { StudentAvatar } from "@/features/students/components/student-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function FinanceDashboardSummary({
  balances,
  termName,
  canEdit,
}: {
  balances: FeeBalancesReport;
  termName: string | null;
  canEdit: boolean;
}) {
  const yearLabel = balances.academicYearName ?? "current year";
  const topOutstanding = balances.rows
    .filter((row) => row.balance > 0)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Outstanding fees"
          value={formatKwacha(balances.totals.balance)}
          hint={`${balances.totals.studentsWithBalance} student${
            balances.totals.studentsWithBalance === 1 ? "" : "s"
          } with a balance`}
          icon={Wallet}
          tone="danger"
        />
        <StatCard
          title="Gross payments received"
          value={formatKwacha(balances.totals.paid)}
          hint={
            termName
              ? `${termName} · allocated ${formatKwacha(balances.totals.allocated)} · credit ${formatKwacha(balances.totals.availableCredit)}`
              : `Allocated ${formatKwacha(balances.totals.allocated)} · credit ${formatKwacha(balances.totals.availableCredit)}`
          }
          icon={Banknote}
          tone="success"
        />
        <StatCard
          title="Today's payments"
          value="—"
          hint="Open a student statement to record or review today's activity"
          icon={Receipt}
        />
        <StatCard
          title="Outstanding students"
          value={String(balances.totals.studentsWithBalance)}
          hint={`Of ${balances.rows.length} enrolled with fee activity`}
          icon={Users}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Highest outstanding balances</CardTitle>
            <CardDescription>
              Accounts needing attention · {yearLabel}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topOutstanding.length === 0 ? (
              <EmptyState
                title="No outstanding balances"
                description="All enrolled students are clear for this academic year."
                icon={
                  <Banknote
                    className="size-6 text-muted-foreground"
                    aria-hidden
                  />
                }
                size="sm"
                action={
                  <Link
                    href="/dashboard/students"
                    className={cn(buttonVariants({ size: "sm" }), "min-h-10")}
                  >
                    Browse students
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y rounded-xl border">
                {topOutstanding.map((row) => (
                  <li key={row.studentId}>
                    <Link
                      href={`/dashboard/students/${row.studentId}?tab=fees`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <StudentAvatar name={row.fullName} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{row.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.admissionNumber}
                          {row.className ? ` · ${row.className}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-red-700 dark:text-red-300">
                        {formatKwacha(row.balance)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Common finance tasks</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <QuickAction
              href="/dashboard/students"
              icon={Receipt}
              label="Record payment"
              description="Open a student statement"
            />
            {canEdit ? (
              <QuickAction
                href="#generate-charges"
                icon={Banknote}
                label="Generate charges"
                description="Bill a class for this term"
              />
            ) : null}
            <QuickAction
              href="/dashboard/students"
              icon={Printer}
              label="Print receipt"
              description="Open a payment receipt from history"
            />
            <QuickAction
              href="/dashboard/reports/fee-balances"
              icon={FileDown}
              label="Export report"
              description="Fee balances report"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  description,
}: {
  href: string;
  icon: typeof Receipt;
  label: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-start gap-3 rounded-xl border px-3 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </Link>
  );
}
