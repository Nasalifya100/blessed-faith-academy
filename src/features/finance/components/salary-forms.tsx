"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

import {
  approveSalaryAction,
  paySalaryAction,
  recordSalaryAction,
  reverseSalaryAction,
} from "../actions";
import { DISBURSEMENT_METHODS, DISBURSEMENT_METHOD_LABELS } from "../schemas";
import { ReverseTransactionButton } from "./reverse-transaction-button";
import type { FinancialAccount, SalaryRow } from "../types";

export interface StaffOption {
  id: string;
  name: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthBounds(): { start: string; end: string; label: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: start.toLocaleDateString("en-ZM", {
      month: "long",
      year: "numeric",
    }),
  };
}

export function RecordSalaryForm({ staff }: { staff: readonly StaffOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const period = monthBounds();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await recordSalaryAction({
        staffId: String(formData.get("staffId") ?? ""),
        periodStart: String(formData.get("periodStart") ?? ""),
        periodEnd: String(formData.get("periodEnd") ?? ""),
        periodLabel: String(formData.get("periodLabel") ?? ""),
        grossAmount: Number(formData.get("grossAmount") ?? 0),
        deductionsAmount: Number(formData.get("deductionsAmount") ?? 0),
        notes: String(formData.get("notes") ?? ""),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Prepare salary
      </Button>
    );
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label="Prepare a salary record"
    >
      <p className="text-sm text-muted-foreground">
        This records what the school pays a staff member for a pay period. It
        is not a statutory payroll calculation — enter the agreed gross and any
        deductions already worked out.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="salary-staff">Staff member</Label>
          <SelectNative id="salary-staff" name="staffId" required>
            <option value="">Choose a staff member</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="salary-label">Pay period</Label>
          <Input
            id="salary-label"
            name="periodLabel"
            defaultValue={period.label}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="salary-start">Period start</Label>
          <Input
            id="salary-start"
            name="periodStart"
            type="date"
            defaultValue={period.start}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="salary-end">Period end</Label>
          <Input
            id="salary-end"
            name="periodEnd"
            type="date"
            defaultValue={period.end}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="salary-gross">Gross pay (K)</Label>
          <Input
            id="salary-gross"
            name="grossAmount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="salary-deductions">Deductions (K)</Label>
          <Input
            id="salary-deductions"
            name="deductionsAmount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            defaultValue="0"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="salary-notes">Notes (optional)</Label>
          <Input id="salary-notes" name="notes" />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save draft"}
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

export function SalaryRowActions({
  salary,
  accounts,
  canApprove,
  canPay,
  canReverse,
}: {
  salary: SalaryRow;
  accounts: readonly FinancialAccount[];
  canApprove: boolean;
  canPay: boolean;
  canReverse: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeAccounts = accounts.filter((account) => account.isActive);

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveSalaryAction({ salaryPaymentId: salary.id });
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
      const result = await paySalaryAction({
        salaryPaymentId: salary.id,
        accountId: String(formData.get("accountId") ?? ""),
        paymentDate: String(formData.get("paymentDate") ?? ""),
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {salary.status === "draft" && canApprove ? (
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

        {salary.status === "approved" && canPay ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => setPayOpen((value) => !value)}
          >
            Mark as paid
          </Button>
        ) : null}

        {salary.status !== "reversed" && canReverse ? (
          <ReverseTransactionButton
            id={salary.id}
            label={`salary for ${salary.periodLabel}`}
            description="The salary record is marked reversed. If it was already paid, the money returns to the paying account."
            onReverse={({ reason }) =>
              reverseSalaryAction({ salaryPaymentId: salary.id, reason })
            }
          />
        ) : null}
      </div>

      {payOpen ? (
        <form
          action={pay}
          className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2"
          aria-label={`Pay salary for ${salary.periodLabel}`}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`salary-account-${salary.id}`} className="text-xs">
              Paying account
            </Label>
            <SelectNative
              id={`salary-account-${salary.id}`}
              name="accountId"
              required
            >
              <option value="">Choose an account</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`salary-date-${salary.id}`} className="text-xs">
              Date paid
            </Label>
            <Input
              id={`salary-date-${salary.id}`}
              name="paymentDate"
              type="date"
              defaultValue={today()}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`salary-method-${salary.id}`} className="text-xs">
              Method (optional)
            </Label>
            <SelectNative id={`salary-method-${salary.id}`} name="paymentMethod">
              <option value="">Not recorded</option>
              {DISBURSEMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {DISBURSEMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </SelectNative>
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
          <input type="hidden" name="reference" value="" />
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
