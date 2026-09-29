"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

import { recordExpenseAction } from "../actions";
import { DISBURSEMENT_METHODS, DISBURSEMENT_METHOD_LABELS } from "../schemas";
import type { ExpenseCategory, FinanceFund, FinancialAccount } from "../types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordExpenseForm({
  categories,
  funds,
  accounts,
}: {
  categories: readonly ExpenseCategory[];
  funds: readonly FinanceFund[];
  accounts: readonly FinancialAccount[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [categoryId, setCategoryId] = useState("");
  const [isPending, startTransition] = useTransition();

  // Salary categories are handled by the Salaries area so pay-period
  // duplicate protection always applies.
  const selectableCategories = categories.filter(
    (category) => category.isActive && !category.isSalary,
  );
  const activeFunds = funds.filter((fund) => fund.isActive);
  const activeAccounts = accounts.filter((account) => account.isActive);

  const suggestedFundId =
    selectableCategories.find((category) => category.id === categoryId)
      ?.defaultFundId ?? "";

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const method = String(formData.get("paymentMethod") ?? "");
      const result = await recordExpenseAction({
        categoryId: String(formData.get("categoryId") ?? ""),
        fundId: String(formData.get("fundId") ?? ""),
        accountId: String(formData.get("accountId") ?? ""),
        amount: Number(formData.get("amount") ?? 0),
        expenseDate: String(formData.get("expenseDate") ?? ""),
        description: String(formData.get("description") ?? ""),
        payee: String(formData.get("payee") ?? ""),
        paymentMethod: method === "" ? undefined : method,
        reference: String(formData.get("reference") ?? ""),
        documentReference: String(formData.get("documentReference") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        clientRequestId: requestId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setRequestId(crypto.randomUUID());
      setOpen(false);
      setCategoryId("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setRequestId(crypto.randomUUID());
          setOpen(true);
        }}
      >
        Record expense
      </Button>
    );
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label="Record expense"
    >
      <p className="text-sm text-muted-foreground">
        Recording an expense does not move money yet. It is approved first,
        then paid — and only payment reduces an account balance.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="expense-category">Category</Label>
          <SelectNative
            id="expense-category"
            name="categoryId"
            required
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Choose a category</option>
            {selectableCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-fund">Which activity bears the cost?</Label>
          <SelectNative
            id="expense-fund"
            name="fundId"
            required
            key={suggestedFundId}
            defaultValue={suggestedFundId}
          >
            <option value="">Choose a fund</option>
            {activeFunds.map((fund) => (
              <option key={fund.id} value={fund.id}>
                {fund.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-account">Which account will pay?</Label>
          <SelectNative id="expense-account" name="accountId" required>
            <option value="">Choose an account</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-amount">Amount (K)</Label>
          <Input
            id="expense-amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-date">Date</Label>
          <Input
            id="expense-date"
            name="expenseDate"
            type="date"
            defaultValue={today()}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-method">Payment method (optional)</Label>
          <SelectNative id="expense-method" name="paymentMethod">
            <option value="">Not decided yet</option>
            {DISBURSEMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {DISBURSEMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="expense-description">Description</Label>
          <Input
            id="expense-description"
            name="description"
            placeholder="e.g. Replacement classroom door handles"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-payee">Paid to (optional)</Label>
          <Input id="expense-payee" name="payee" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-reference">Reference (optional)</Label>
          <Input id="expense-reference" name="reference" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-document">
            Receipt or invoice number (optional)
          </Label>
          <Input id="expense-document" name="documentReference" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-notes">Notes (optional)</Label>
          <Input id="expense-notes" name="notes" />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save expense"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
