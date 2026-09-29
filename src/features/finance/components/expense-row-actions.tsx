"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

import {
  approveExpenseAction,
  payExpenseAction,
  reverseExpenseAction,
} from "../actions";
import { ReverseTransactionButton } from "./reverse-transaction-button";
import type { ExpenseRow, FinancialAccount } from "../types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseRowActions({
  expense,
  accounts,
  canApprove,
  canPay,
  canReverse,
}: {
  expense: ExpenseRow;
  accounts: readonly FinancialAccount[];
  canApprove: boolean;
  canPay: boolean;
  canReverse: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveExpenseAction({ expenseId: expense.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function pay(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const method = String(formData.get("paymentMethod") ?? "");
      const result = await payExpenseAction({
        expenseId: expense.id,
        accountId: String(formData.get("accountId") ?? ""),
        paidOn: String(formData.get("paidOn") ?? ""),
        paymentMethod: method === "" ? undefined : method,
        reference: String(formData.get("reference") ?? ""),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setPayOpen(false);
      router.refresh();
    });
  }

  const activeAccounts = accounts.filter((account) => account.isActive);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {expense.status === "recorded" && canApprove ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={approve}
          >
            Approve
          </Button>
        ) : null}

        {expense.status === "approved" && canPay ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => setPayOpen((value) => !value)}
          >
            Mark as paid
          </Button>
        ) : null}

        {expense.status !== "reversed" && canReverse ? (
          <ReverseTransactionButton
            id={expense.id}
            label={`expense ${expense.description}`}
            description={
              expense.status === "paid"
                ? "The money will be returned to the account it was paid from, and both records stay on file."
                : "The expense will be closed as reversed and stays on file."
            }
            onReverse={({ reason }) =>
              reverseExpenseAction({ expenseId: expense.id, reason })
            }
          />
        ) : null}
      </div>

      {payOpen ? (
        <form
          action={pay}
          className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2"
          aria-label={`Pay ${expense.description}`}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`pay-account-${expense.id}`} className="text-xs">
              Paying account
            </Label>
            <SelectNative
              id={`pay-account-${expense.id}`}
              name="accountId"
              defaultValue={expense.accountId}
              required
            >
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pay-date-${expense.id}`} className="text-xs">
              Date paid
            </Label>
            <Input
              id={`pay-date-${expense.id}`}
              name="paidOn"
              type="date"
              defaultValue={today()}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pay-reference-${expense.id}`} className="text-xs">
              Reference (optional)
            </Label>
            <Input id={`pay-reference-${expense.id}`} name="reference" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Paying…" : "Confirm payment"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPayOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
