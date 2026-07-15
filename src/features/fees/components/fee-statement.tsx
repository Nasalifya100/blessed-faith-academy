"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { cancelOptionalChargeAction } from "@/features/fees/actions";
import type { StudentFeeStatement } from "@/features/fees/queries";
import { FEE_CATEGORY_LABELS } from "@/features/fees/schemas";
import { formatKwacha } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const METHOD_LABELS: Record<string, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
};

interface FeeStatementProps {
  statement: StudentFeeStatement;
  studentId: string;
  canManageFees?: boolean;
}

function categoryLabel(category: string): string {
  if (category in FEE_CATEGORY_LABELS) {
    return FEE_CATEGORY_LABELS[category as keyof typeof FEE_CATEGORY_LABELS];
  }
  return category;
}

export function FeeStatement({
  statement,
  studentId,
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
      {(mealCharges.length > 0 || uniformCharges.length > 0) && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total charged</p>
          <p className="text-lg font-semibold">
            {formatKwacha(statement.totalCharged)}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total paid</p>
          <p className="text-lg font-semibold">
            {formatKwacha(statement.totalPaid)}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p
            className={`text-lg font-semibold ${
              statement.balance > 0 ? "text-destructive" : "text-emerald-600"
            }`}
          >
            {formatKwacha(statement.balance)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Charges</h3>
        {statement.charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No charges yet for
            {statement.academicYearName
              ? ` ${statement.academicYearName}`
              : " this year"}
            .
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canManageFees ? <TableHead className="w-24" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.charges.map((charge) => {
                  const canCancel =
                    canManageFees &&
                    charge.isOptional &&
                    (charge.category === "meal" ||
                      charge.category === "uniform");
                  return (
                    <TableRow key={charge.id}>
                      <TableCell>{charge.description}</TableCell>
                      <TableCell>
                        <Badge
                          variant={charge.isOptional ? "secondary" : "outline"}
                        >
                          {categoryLabel(charge.category)}
                        </Badge>
                      </TableCell>
                      <TableCell>{charge.termName ?? "Year"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {charge.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatKwacha(charge.amount)}
                      </TableCell>
                      {canManageFees ? (
                        <TableCell className="text-right">
                          {canCancel ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isPending && pendingId === charge.id}
                              onClick={() => onCancel(charge.id)}
                            >
                              {isPending && pendingId === charge.id
                                ? "…"
                                : "Remove"}
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {canManageFees &&
        (mealCharges.length > 0 || uniformCharges.length > 0) ? (
          <p className="text-xs text-muted-foreground">
            Use Remove on a meal or uniform line to take it off the statement
            (e.g. to switch meal plan).
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Payments</h3>
        {statement.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/payments/${payment.id}/receipt`}
                        className="hover:underline"
                      >
                        {payment.receiptNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {METHOD_LABELS[payment.method] ?? payment.method}
                    </TableCell>
                    <TableCell>{payment.paidOn}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatKwacha(payment.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
