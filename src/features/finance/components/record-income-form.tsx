"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

import { recordFundIncomeAction } from "../actions";
import type { FinanceFund, FinancialAccount } from "../types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Income that does not come through a student receipt: tuck shop takings,
 * uniform sales to the public, donations, hire income.
 */
export function RecordIncomeForm({
  funds,
  accounts,
}: {
  funds: readonly FinanceFund[];
  accounts: readonly FinancialAccount[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();

  // School fee money must be receipted through the student payment flow.
  const selectableFunds = funds.filter(
    (fund) => fund.isActive && !fund.isSchoolFees,
  );
  const selectableAccounts = accounts.filter((account) => account.isActive);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await recordFundIncomeAction({
        fundId: String(formData.get("fundId") ?? ""),
        accountId: String(formData.get("accountId") ?? ""),
        amount: Number(formData.get("amount") ?? 0),
        receivedOn: String(formData.get("receivedOn") ?? ""),
        description: String(formData.get("description") ?? ""),
        reference: String(formData.get("reference") ?? ""),
        payer: String(formData.get("payer") ?? ""),
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
        Record income
      </Button>
    );
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label="Record income"
    >
      <p className="text-sm text-muted-foreground">
        Use this for money the school receives outside student fee receipts.
        School fee payments must be recorded against a student so a receipt is
        issued.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="income-fund">What is this money for?</Label>
          <SelectNative id="income-fund" name="fundId" required>
            <option value="">Choose a fund</option>
            {selectableFunds.map((fund) => (
              <option key={fund.id} value={fund.id}>
                {fund.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="income-account">Where was it received?</Label>
          <SelectNative id="income-account" name="accountId" required>
            <option value="">Choose an account</option>
            {selectableAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="income-amount">Amount (K)</Label>
          <Input
            id="income-amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="income-date">Date received</Label>
          <Input
            id="income-date"
            name="receivedOn"
            type="date"
            defaultValue={today()}
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="income-description">Description</Label>
          <Input
            id="income-description"
            name="description"
            placeholder="e.g. Tuck shop takings for the week"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="income-payer">Received from (optional)</Label>
          <Input id="income-payer" name="payer" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="income-reference">Reference (optional)</Label>
          <Input id="income-reference" name="reference" />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save income"}
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
