"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { upsertAccountAction } from "../actions";
import type { FinancialAccount } from "../types";

/**
 * Sets the cutover balance. The database freezes it once the account has any
 * ledger entry or assigned receipt, so this has to happen first.
 */
export function SetOpeningBalanceForm({
  account,
  blocked = false,
}: {
  account: FinancialAccount;
  /** True when attributed receipts or ledger rows already prevent the first save. */
  blocked?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await upsertAccountAction({
        accountId: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        description: account.description ?? "",
        maskedReference: account.maskedReference ?? "",
        openingBalance: Number(formData.get("openingBalance") ?? 0),
        openingBalanceDate: String(formData.get("openingBalanceDate") ?? ""),
        isActive: account.isActive,
        sortOrder: account.sortOrder,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <section
        className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40"
        aria-label="Opening balance blocked"
      >
        <p className="font-medium">Opening balance cannot be entered</p>
        <p className="text-muted-foreground">
          This account already has a receipt or another movement, so the
          database will not accept an opening balance. Do not add the old
          receipts on top of a counted balance, and do not assign a historical
          receipt to Bank, Mobile Money, or Petty Cash from this screen.
        </p>
      </section>
    );
  }

  return (
    <form
      action={onSubmit}
      className="space-y-3 rounded-xl border bg-muted/20 p-4"
      aria-label="Set opening balance"
    >
      <p className="text-sm text-muted-foreground">
        Enter the actual amount held in this account at the end of the cutover
        date. That amount should already include every transaction up to and
        including that date. Transactions after that date are added or
        subtracted automatically. A receipt dated on the cutover date is not
        added again. The date cannot be changed once the account has a
        transaction.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="openingBalance">Opening balance (K)</Label>
          <Input
            id="openingBalance"
            name="openingBalance"
            type="number"
            min={0}
            step="0.01"
            defaultValue={account.openingBalance}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="openingBalanceDate">Balance true at the end of</Label>
          <Input
            id="openingBalanceDate"
            name="openingBalanceDate"
            type="date"
            defaultValue={account.openingBalanceDate ?? ""}
            required
          />
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : "Save opening balance"}
      </Button>
    </form>
  );
}
