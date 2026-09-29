"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { formatKwacha } from "@/lib/money";

import { addPettyCashAction, recordTransferAction } from "../actions";
import {
  openingBalanceConfigured,
  primaryPettyCashAccount,
} from "../presentation";
import type { FinancialAccount } from "../types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordTransferForm({
  accounts,
  pettyCashTopUp = false,
  buttonLabel = "Move money between accounts",
  submitLabel = "Record transfer",
  defaultDescription = "",
}: {
  accounts: readonly FinancialAccount[];
  /** The server chooses the active petty-cash account as the destination. */
  pettyCashTopUp?: boolean;
  buttonLabel?: string;
  submitLabel?: string;
  defaultDescription?: string;
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
      const shared = {
        fromAccountId: String(formData.get("fromAccountId") ?? ""),
        amount: Number(formData.get("amount") ?? 0),
        transferDate: String(formData.get("transferDate") ?? ""),
        description:
          String(formData.get("description") ?? "") || defaultDescription,
        reference: String(formData.get("reference") ?? ""),
        clientRequestId: requestId,
      };
      const result = pettyCashTopUp
        ? await addPettyCashAction(shared)
        : await recordTransferAction({
            ...shared,
            toAccountId: String(formData.get("toAccountId") ?? ""),
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
        className="min-h-11"
        onClick={() => {
          setRequestId(crypto.randomUUID());
          setOpen(true);
        }}
      >
        {buttonLabel}
      </Button>
    );
  }

  const destination = pettyCashTopUp
    ? primaryPettyCashAccount(activeAccounts)
    : null;
  const sourceAccounts = destination
    ? activeAccounts.filter((account) => account.id !== destination.id)
    : activeAccounts;

  function balanceLabel(account: FinancialAccount): string {
    return openingBalanceConfigured(account)
      ? formatKwacha(account.currentBalance)
      : "opening balance required";
  }

  return (
    <form
      action={onSubmit}
      className="w-full space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label={destination ? "Add money to petty cash" : "Transfer between accounts"}
    >
      <p className="text-sm text-muted-foreground">
        {destination
          ? `This moves money the school already holds into ${destination.name}. It is not income and it is not an expense. Amounts are in Zambian kwacha.`
          : "A transfer moves money the school already has from one place to another. It is not income and not an expense. Amounts are in Zambian kwacha."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="transfer-from">From</Label>
          <SelectNative id="transfer-from" name="fromAccountId" required className="h-11">
            <option value="">Choose an account</option>
            {sourceAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {balanceLabel(account)}
              </option>
            ))}
          </SelectNative>
        </div>

        {destination ? (
          <div className="space-y-1.5">
            <Label>Into</Label>
            <p className="text-sm font-medium">{destination.name}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="transfer-to">To</Label>
            <SelectNative id="transfer-to" name="toAccountId" required className="h-11">
              <option value="">Choose an account</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {balanceLabel(account)}
                </option>
              ))}
            </SelectNative>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="transfer-amount">Amount (ZMW)</Label>
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
            defaultValue={defaultDescription}
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
          {isPending ? "Saving…" : submitLabel}
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
