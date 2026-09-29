"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

import { recordActivityIncomeAction, recordFundIncomeAction } from "../actions";
import {
  activityIncomeDescription,
  type ContextualActivityCode,
} from "../presentation";
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
  activityCode,
  buttonLabel = "Record income",
  submitLabel = "Save income",
  formLabel = "Record income",
  defaultDescription,
}: {
  funds: readonly FinanceFund[];
  accounts: readonly FinancialAccount[];
  /** Activity pages send a code. The server resolves the fund. */
  activityCode?: ContextualActivityCode;
  buttonLabel?: string;
  submitLabel?: string;
  formLabel?: string;
  /** Used when the optional notes field is left blank. */
  defaultDescription?: string;
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
      const notes = String(formData.get("notes") ?? "");
      const description = defaultDescription
        ? activityIncomeDescription(notes, defaultDescription)
        : String(formData.get("description") ?? "");
      const shared = {
        accountId: String(formData.get("accountId") ?? ""),
        amount: Number(formData.get("amount") ?? 0),
        receivedOn: String(formData.get("receivedOn") ?? ""),
        description,
        reference: String(formData.get("reference") ?? ""),
        payer: String(formData.get("payer") ?? ""),
        clientRequestId: requestId,
      };
      const result = activityCode
        ? await recordActivityIncomeAction({ ...shared, activityCode })
        : await recordFundIncomeAction({
            ...shared,
            fundId: String(formData.get("fundId") ?? ""),
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

  const lockedFund = selectableFunds.find((fund) => fund.code === activityCode);

  return (
    <form
      action={onSubmit}
      className="w-full space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label={formLabel}
    >
      <p className="text-sm text-muted-foreground">
        {lockedFund
          ? `This is ${lockedFund.name} income. Choose only where the money was received. Amounts are in Zambian kwacha.`
          : "Use this for money the school receives outside student fee receipts. School fee payments must be recorded against a student so a receipt is issued. Amounts are in Zambian kwacha."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {lockedFund ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="income-fund">What is this money for?</Label>
            <SelectNative id="income-fund" name="fundId" required>
              <option value="">Choose an activity</option>
              {selectableFunds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name}
                </option>
              ))}
            </SelectNative>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="income-account">Money received in</Label>
          <SelectNative id="income-account" name="accountId" required className="h-11">
            <option value="">Choose where the money is</option>
            {selectableAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="income-amount">Amount (ZMW)</Label>
          <Input
            id="income-amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            className="min-h-11"
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

        {defaultDescription ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="income-notes">Notes (optional)</Label>
            <Input id="income-notes" name="notes" className="min-h-11" />
          </div>
        ) : (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="income-description">What was received?</Label>
            <Input
              id="income-description"
              name="description"
              placeholder="e.g. Hall hire for the weekend"
              className="min-h-11"
              required
            />
          </div>
        )}

        {defaultDescription ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="income-payer">Received from (optional)</Label>
            <Input id="income-payer" name="payer" className="min-h-11" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="income-reference">Reference (optional)</Label>
          <Input id="income-reference" name="reference" className="min-h-11" />
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
