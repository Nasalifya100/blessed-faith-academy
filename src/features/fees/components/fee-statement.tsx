"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  History,
  PlusCircle,
  Printer,
  Receipt,
  Undo2,
  XCircle,
} from "lucide-react";

import { cancelOptionalChargeAction } from "@/features/fees/actions";
import type {
  StatementCharge,
  StatementPayment,
  StudentFeeStatement,
} from "@/features/fees/queries";
import { FEE_CATEGORY_LABELS } from "@/features/fees/schemas";
import { ReversePaymentButton } from "@/features/fees/components/reverse-payment-button";
import {
  ChargeStatusBadge,
  PaymentStatusBadge,
} from "@/features/fees/components/charge-status-badge";
import { StudentFinancialOverview } from "@/features/fees/components/student-financial-overview";
import { FinanceEmptyState } from "@/features/fees/components/finance-empty-state";
import { formatKwacha } from "@/lib/money";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const METHOD_LABELS: Record<string, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
};

interface FeeStatementProps {
  statement: StudentFeeStatement;
  studentId: string;
  studentName?: string;
  admissionNumber?: string;
  studentGradeName?: string | null;
  studentClassName?: string | null;
  studentStatus?: string;
  canManageFees?: boolean;
}

type TimelineEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  amount: number | null;
  kind: "charge" | "payment" | "reversal" | "waived";
};

function categoryLabel(category: string): string {
  if (category in FEE_CATEGORY_LABELS) {
    return FEE_CATEGORY_LABELS[category as keyof typeof FEE_CATEGORY_LABELS];
  }
  return category;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function canCancelOptionalCharge(
  charge: StatementCharge,
  canManageFees: boolean,
): boolean {
  return (
    canManageFees &&
    charge.isOptional &&
    charge.status === "outstanding" &&
    (charge.category === "meal" || charge.category === "uniform")
  );
}

function buildTimeline(statement: StudentFeeStatement): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const charge of statement.charges) {
    events.push({
      id: `charge-${charge.id}`,
      at: charge.createdAt,
      title:
        charge.status === "waived"
          ? "Charge waived"
          : "Charge created",
      detail: `${charge.description}${
        charge.termName ? ` · ${charge.termName}` : ""
      } · ${categoryLabel(charge.category)}`,
      amount: charge.amount,
      kind: charge.status === "waived" ? "waived" : "charge",
    });
  }

  for (const payment of statement.payments) {
    events.push({
      id: `payment-${payment.id}`,
      at: payment.paidOn,
      title: "Payment recorded",
      detail: `${payment.receiptNumber} · ${
        METHOD_LABELS[payment.method] ?? payment.method
      }`,
      amount: payment.amount,
      kind: "payment",
    });
  }

  for (const payment of statement.voidedPayments) {
    events.push({
      id: `void-${payment.id}`,
      at: payment.voidedAt ?? payment.paidOn,
      title: "Payment reversed",
      detail: `${payment.receiptNumber}${
        payment.voidReason ? ` · ${payment.voidReason}` : ""
      }`,
      amount: payment.amount,
      kind: "reversal",
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function FeeStatement({
  statement,
  studentId,
  studentName,
  admissionNumber,
  studentGradeName,
  studentClassName,
  studentStatus,
  canManageFees = false,
}: FeeStatementProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const mealCharges = statement.charges.filter((c) => c.category === "meal");
  const uniformCharges = statement.charges.filter(
    (c) => c.category === "uniform",
  );
  const paymentRows: StatementPayment[] = [
    ...statement.payments,
    ...statement.voidedPayments,
  ].sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  const timeline = buildTimeline(statement);

  function onCancel(chargeId: string) {
    setError(null);
    setPendingId(chargeId);
    startTransition(async () => {
      const result = await cancelOptionalChargeAction({
        chargeId,
        studentId,
      });
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <StudentFinancialOverview
        statement={statement}
        studentName={studentName}
        admissionNumber={admissionNumber}
        studentGradeName={studentGradeName}
        studentClassName={studentClassName}
        studentStatus={studentStatus}
      />

      {(mealCharges.length > 0 || uniformCharges.length > 0) && (
        <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm shadow-sm">
          <p className="font-medium">Optional on this statement</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {mealCharges.map((charge) => (
              <li key={charge.id}>
                Meal: {charge.description}
                {charge.termName ? ` (${charge.termName})` : ""} —{" "}
                {formatKwacha(charge.amount)}
              </li>
            ))}
            {uniformCharges.map((charge) => (
              <li key={charge.id}>
                Uniform: {charge.description} — {formatKwacha(charge.amount)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="charges">
        <TabsList aria-label="Fee statement sections">
          <TabsTrigger value="charges" className="gap-1.5">
            <CreditCard className="size-3.5" aria-hidden />
            Charges
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5">
            <Banknote className="size-3.5" aria-hidden />
            Payments
          </TabsTrigger>
          <TabsTrigger value="receipts" className="gap-1.5">
            <Receipt className="size-3.5" aria-hidden />
            Receipts
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="size-3.5" aria-hidden />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="charges" className="space-y-3">
          {statement.charges.length === 0 ? (
            <FinanceEmptyState
              title="No charges on this statement"
              description={
                statement.academicYearName
                  ? `Generate mandatory fees or add optional items for ${statement.academicYearName}.`
                  : "Generate mandatory fees or add optional meal and uniform items to begin."
              }
              icon={
                <PlusCircle className="size-6 text-muted-foreground" aria-hidden />
              }
            />
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {statement.charges.map((charge) => {
                  const canCancel = canCancelOptionalCharge(
                    charge,
                    canManageFees,
                  );
                  return (
                    <article
                      key={charge.id}
                      className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium">{charge.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {categoryLabel(charge.category)}
                            {charge.termName ? ` · ${charge.termName}` : ""}
                            {charge.isOptional ? " · Optional" : ""}
                          </p>
                        </div>
                        <ChargeStatusBadge status={charge.status} />
                      </div>
                      <p className="text-right text-lg font-semibold tabular-nums">
                        {formatKwacha(charge.amount)}
                      </p>
                      {canManageFees ? (
                        <div className="border-t pt-3">
                          {canCancel ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full"
                              disabled={isPending && pendingId === charge.id}
                              onClick={() => onCancel(charge.id)}
                              aria-label={`Cancel optional charge ${charge.description}`}
                            >
                              {isPending && pendingId === charge.id
                                ? "Cancelling…"
                                : "Cancel optional charge"}
                            </Button>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {charge.isOptional
                                ? "Cancel is only available while this optional line is outstanding and unpaid."
                                : "Mandatory charges cannot be cancelled here."}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
                <div className="relative max-h-[min(60vh,32rem)] overflow-auto">
                  <Table>
                    <TableHeader className={stickyHeaderClass}>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Term</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        {canManageFees ? (
                          <TableHead className="w-44 text-right">
                            Actions
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statement.charges.map((charge) => {
                        const canCancel = canCancelOptionalCharge(
                          charge,
                          canManageFees,
                        );
                        return (
                          <TableRow
                            key={charge.id}
                            className="transition-colors hover:bg-muted/40"
                          >
                            <TableCell className="font-medium">
                              {charge.description}
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                tone={charge.isOptional ? "info" : "neutral"}
                              >
                                {categoryLabel(charge.category)}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>{charge.termName ?? "Year"}</TableCell>
                            <TableCell>
                              <ChargeStatusBadge status={charge.status} />
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {formatKwacha(charge.amount)}
                            </TableCell>
                            {canManageFees ? (
                              <TableCell className="text-right">
                                {canCancel ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                      isPending && pendingId === charge.id
                                    }
                                    onClick={() => onCancel(charge.id)}
                                    aria-label={`Cancel optional charge ${charge.description}`}
                                  >
                                    {isPending && pendingId === charge.id
                                      ? "Cancelling…"
                                      : "Cancel"}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {canManageFees &&
          (mealCharges.length > 0 || uniformCharges.length > 0) ? (
            <p className="text-xs text-muted-foreground">
              Cancel is only available for outstanding unpaid meal or uniform
              lines. If payments already cover the statement, reverse a payment
              first.
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="payments" className="space-y-3">
          {paymentRows.length === 0 ? (
            <FinanceEmptyState
              title="No payments recorded"
              description="Record a payment against the outstanding balance to see it listed here with receipt details."
              icon={
                <Banknote className="size-6 text-muted-foreground" aria-hidden />
              }
            />
          ) : (
            <ul className="space-y-3">
              {paymentRows.map((payment) => {
                const voided = payment.status === "voided";
                return (
                  <li key={payment.id}>
                    <Card
                      className={cn(
                        "shadow-sm",
                        voided && "border-dashed bg-muted/20",
                      )}
                    >
                      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p
                              className={cn(
                                "text-2xl font-semibold tracking-tight tabular-nums",
                                voided
                                  ? "text-muted-foreground line-through"
                                  : "text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {formatKwacha(payment.amount)}
                            </p>
                            <PaymentStatusBadge status={payment.status} />
                          </div>
                          <dl className="grid gap-2 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Date
                              </dt>
                              <dd>{formatPaidOn(payment.paidOn)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Method
                              </dt>
                              <dd>
                                {METHOD_LABELS[payment.method] ??
                                  payment.method}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Receipt number
                              </dt>
                              <dd className="font-mono text-xs">
                                {payment.receiptNumber}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Reference
                              </dt>
                              <dd className="text-muted-foreground">
                                See receipt for reference details
                              </dd>
                            </div>
                            {voided ? (
                              <div className="sm:col-span-2">
                                <dt className="text-xs text-muted-foreground">
                                  Reversal reason
                                </dt>
                                <dd>{payment.voidReason ?? "—"}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                          <Link
                            href={`/dashboard/payments/${payment.id}/receipt`}
                            className={cn(
                              buttonVariants({
                                variant: "outline",
                                size: "sm",
                              }),
                              "gap-1.5",
                            )}
                          >
                            <Receipt className="size-3.5" aria-hidden />
                            View receipt
                          </Link>
                          {canManageFees && !voided ? (
                            <ReversePaymentButton
                              paymentId={payment.id}
                              studentId={studentId}
                              receiptNumber={payment.receiptNumber}
                            />
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="receipts" className="space-y-3">
          {paymentRows.length === 0 ? (
            <FinanceEmptyState
              title="No receipts yet"
              description="Receipts are created automatically when a payment is saved. Open a receipt to print or download."
              icon={
                <Receipt className="size-6 text-muted-foreground" aria-hidden />
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {paymentRows.map((payment) => {
                const voided = payment.status === "voided";
                return (
                  <article
                    key={payment.id}
                    className={cn(
                      "flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm",
                      voided && "border-dashed bg-muted/20",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Receipt
                        </p>
                        <p className="font-mono text-sm font-semibold break-all">
                          {payment.receiptNumber}
                        </p>
                      </div>
                      <PaymentStatusBadge status={payment.status} />
                    </div>
                    <div>
                      <p
                        className={cn(
                          "text-xl font-semibold tabular-nums",
                          voided && "text-muted-foreground line-through",
                        )}
                      >
                        {formatKwacha(payment.amount)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatPaidOn(payment.paidOn)} ·{" "}
                        {METHOD_LABELS[payment.method] ?? payment.method}
                      </p>
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2 border-t pt-3">
                      <Link
                        href={`/dashboard/payments/${payment.id}/receipt`}
                        className={cn(
                          buttonVariants({ size: "sm" }),
                          "gap-1.5",
                        )}
                      >
                        <Receipt className="size-3.5" aria-hidden />
                        View
                      </Link>
                      <Link
                        href={`/dashboard/payments/${payment.id}/receipt`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "gap-1.5",
                        )}
                      >
                        <Printer className="size-3.5" aria-hidden />
                        Print
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {timeline.length === 0 ? (
            <FinanceEmptyState
              title="No financial history yet"
              description="Charges, payments, and reversals for this student will appear on this timeline as they happen."
              icon={
                <History className="size-6 text-muted-foreground" aria-hidden />
              }
            />
          ) : (
            <ol className="relative ml-3 space-y-0 border-l">
              {timeline.map((event) => {
                const Icon =
                  event.kind === "reversal"
                    ? Undo2
                    : event.kind === "payment"
                      ? CheckCircle2
                      : event.kind === "waived"
                        ? XCircle
                        : PlusCircle;
                const iconClass =
                  event.kind === "reversal"
                    ? "text-muted-foreground"
                    : event.kind === "payment"
                      ? "text-emerald-600"
                      : event.kind === "waived"
                        ? "text-muted-foreground"
                        : "text-sky-700 dark:text-sky-300";
                return (
                  <li
                    key={event.id}
                    className="relative pb-6 pl-8 last:pb-0"
                  >
                    <span className="absolute top-0 -left-3.5 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm">
                      <Icon className={cn("size-3.5", iconClass)} aria-hidden />
                    </span>
                    <div className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{event.title}</p>
                        <time
                          dateTime={event.at}
                          className="text-xs text-muted-foreground"
                        >
                          {formatDateTime(event.at)}
                        </time>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {event.detail}
                      </p>
                      {event.amount !== null ? (
                        <p
                          className={cn(
                            "text-base font-semibold tabular-nums",
                            event.kind === "reversal" &&
                              "text-muted-foreground line-through",
                            event.kind === "payment" &&
                              "text-emerald-700 dark:text-emerald-300",
                          )}
                        >
                          {formatKwacha(event.amount)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
