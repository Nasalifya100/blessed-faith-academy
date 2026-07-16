import {
  ArrowRight,
  Banknote,
  CircleDollarSign,
  Receipt,
  Wallet,
} from "lucide-react";

import type { StudentFeeStatement } from "@/features/fees/queries";
import { StudentStatusBadge } from "@/features/students/components/status-badge";
import { StudentAvatar } from "@/features/students/components/student-avatar";
import { formatKwacha } from "@/lib/money";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

const METHOD_LABELS: Record<string, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
};

export type PaymentStatusKind =
  | "paid_in_full"
  | "partially_paid"
  | "outstanding"
  | "cancelled";

const PAYMENT_STATUS_META: Record<
  PaymentStatusKind,
  { label: string; tone: StatusTone }
> = {
  paid_in_full: { label: "Paid in Full", tone: "success" },
  partially_paid: { label: "Partially Paid", tone: "warning" },
  outstanding: { label: "Outstanding", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function derivePaymentStatus(
  balance: number,
  totalPaid: number,
  totalCharged: number,
): PaymentStatusKind {
  if (totalCharged <= 0) return "cancelled";
  if (balance <= 0) return "paid_in_full";
  if (totalPaid > 0) return "partially_paid";
  return "outstanding";
}

function formatPaidOn(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function StudentFinancialOverview({
  statement,
  studentName,
  admissionNumber,
  studentGradeName,
  studentClassName,
  studentStatus,
}: {
  statement: StudentFeeStatement;
  studentName?: string;
  admissionNumber?: string;
  studentGradeName?: string | null;
  studentClassName?: string | null;
  studentStatus?: string;
}) {
  const paymentStatus = derivePaymentStatus(
    statement.balance,
    statement.totalPaid,
    statement.totalCharged,
  );
  const statusMeta = PAYMENT_STATUS_META[paymentStatus];

  const progressPercent =
    statement.totalCharged > 0
      ? Math.min(
          100,
          Math.max(0, (statement.totalPaid / statement.totalCharged) * 100),
        )
      : 0;

  const lastPayment = [...statement.payments].sort((a, b) =>
    b.paidOn.localeCompare(a.paidOn),
  )[0];

  const outstandingChargesCount = statement.charges.filter(
    (charge) => charge.status === "outstanding",
  ).length;

  const receiptsCount =
    statement.payments.length + statement.voidedPayments.length;

  const optionalOutstanding = statement.charges.filter(
    (charge) =>
      charge.isOptional &&
      charge.status === "outstanding" &&
      (charge.category === "meal" || charge.category === "uniform"),
  );

  let recommendedAction = "Review fee statement";
  if (statement.balance > 0) {
    recommendedAction = "Record Payment";
  } else if (optionalOutstanding.length > 0) {
    recommendedAction = "Review Optional Charges";
  } else if (statement.totalCharged > 0 && statement.balance <= 0) {
    recommendedAction = "Account Fully Paid";
  }

  const displayName = studentName ?? "Student";

  return (
    <section
      aria-labelledby="student-financial-overview-heading"
      className="space-y-6"
    >
      <div className="space-y-1">
        <h2
          id="student-financial-overview-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Financial overview
        </h2>
        <p className="text-sm text-muted-foreground">
          Instant view of this student&apos;s fee position for
          {statement.academicYearName
            ? ` ${statement.academicYearName}`
            : " the current academic year"}
          {statement.currentTermName
            ? ` · ${statement.currentTermName}`
            : ""}
          .
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-4">
            <StudentAvatar
              name={displayName}
              className="size-14 text-base"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xl font-semibold tracking-tight">
                  {displayName}
                </p>
                {studentStatus ? (
                  <StudentStatusBadge status={studentStatus} />
                ) : null}
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Admission number
                  </dt>
                  <dd className="font-mono">
                    {admissionNumber ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Grade</dt>
                  <dd>{studentGradeName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Class</dt>
                  <dd>{studentClassName ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding balance
            </CardTitle>
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <Wallet className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                "text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl",
                statement.balance > 0
                  ? "text-red-700 dark:text-red-300"
                  : "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {formatKwacha(statement.balance)}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total charged
            </CardTitle>
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <CircleDollarSign
                className="size-4 text-muted-foreground"
                aria-hidden
              />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
              {formatKwacha(statement.totalCharged)}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total paid
            </CardTitle>
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <Banknote className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight tabular-nums text-emerald-700 sm:text-3xl dark:text-emerald-300">
              {formatKwacha(statement.totalPaid)}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Payment status
            </CardTitle>
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <Receipt className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </CardHeader>
          <CardContent>
            <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Payment progress</CardTitle>
          <CardDescription>
            Share of charged fees already collected for this statement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Percentage paid
              </p>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {Math.round(progressPercent)}%
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Outstanding
              </p>
              <p
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  statement.balance > 0
                    ? "text-red-700 dark:text-red-300"
                    : "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {formatKwacha(statement.balance)}
              </p>
            </div>
          </div>
          <Progress
            value={progressPercent}
            aria-label={`Payment progress ${Math.round(progressPercent)} percent`}
          />
          <p className="text-xs text-muted-foreground">
            {formatKwacha(statement.totalPaid)} paid of{" "}
            {formatKwacha(statement.totalCharged)} charged
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Financial insights</CardTitle>
          <CardDescription>
            Derived from this student&apos;s loaded statement only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Insight
              label="Last payment date"
              value={
                lastPayment ? formatPaidOn(lastPayment.paidOn) : "No payments yet"
              }
            />
            <Insight
              label="Last payment amount"
              value={
                lastPayment ? formatKwacha(lastPayment.amount) : "—"
              }
            />
            <Insight
              label="Payment method"
              value={
                lastPayment
                  ? (METHOD_LABELS[lastPayment.method] ?? lastPayment.method)
                  : "—"
              }
            />
            <Insight
              label="Outstanding charges"
              value={String(outstandingChargesCount)}
            />
            <Insight label="Number of receipts" value={String(receiptsCount)} />
            <div className="rounded-xl border bg-muted/20 p-4 sm:col-span-2 lg:col-span-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Recommended next action
              </dt>
              <dd className="mt-2 flex items-center gap-2 text-sm font-semibold">
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                {recommendedAction}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold">{value}</dd>
    </div>
  );
}
