"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { formatKwacha } from "@/lib/money";

import { recordTransferAction } from "../actions";
import type { FinancialAccount } from "../types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordTransferForm({
  accounts,
}: {
  accounts: readonly FinancialAccount[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();

  const activeAccounts = accounts.filter((account) => account.isActive);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await recordTransferAction({
        fromAccountId: String(formData.get("fromAccountId") ?? ""),
        toAccountId: String(formData.get("toAccountId") ?? ""),
        amount: Number(formData.get("amount") ?? 0),
        transferDate: String(formData.get("transferDate") ?? ""),
        description: String(formData.get("description") ?? ""),
        reference: String(formData.get("reference") ?? ""),
        clientRequestId: requestId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setRequestId(crypto.randomUUID());
      setOpen(false);
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
        Move money between accounts
      </Button>
    );
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label="Transfer between accounts"
    >
      <p className="text-sm text-muted-foreground">
        A transfer moves money the school already has from one place to
        another. It is <strong>not</strong> income and <strong>not</strong> an
        expense, so it will not appear in either total. A transfer is still
        recorded if it takes an account below zero; the shortfall is shown on
        that account.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="transfer-from">From</Label>
          <SelectNative id="transfer-from" name="fromAccountId" required>
            <option value="">Choose an account</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {formatKwacha(account.currentBalance)}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="transfer-to">To</Label>
          <SelectNative id="transfer-to" name="toAccountId" required>
            <option value="">Choose an account</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {formatKwacha(account.currentBalance)}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="transfer-amount">Amount (K)</Label>
          <Input
            id="transfer-amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="transfer-date">Date</Label>
          <Input
            id="transfer-date"
            name="transferDate"
            type="date"
            defaultValue={today()}
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="transfer-description">Reason</Label>
          <Input
            id="transfer-description"
            name="description"
            placeholder="e.g. Petty cash top-up for the month"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="transfer-reference">Reference (optional)</Label>
          <Input id="transfer-reference" name="reference" />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Moving…" : "Record transfer"}
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
