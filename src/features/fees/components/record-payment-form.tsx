"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import {
  recordPaymentSchema,
  type RecordPaymentInput,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/features/fees/schemas";
import { recordPaymentAction } from "@/features/fees/actions";
import { formatKwacha } from "@/lib/money";
import { schoolToday } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface RecordPaymentFormProps {
  studentId: string;
  currentBalance: number;
}

const today = () => schoolToday();

export function RecordPaymentForm({
  studentId,
  currentBalance,
}: RecordPaymentFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Stable per form open-session so retries / double-submit reuse the same key
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );

  const defaultValues = useMemo(
    () => ({
      studentId,
      amount: undefined as unknown as number,
      method: "mobile_money" as const,
      idempotencyKey,
      reference_number: "",
      paid_on: today(),
      notes: "",
    }),
    [studentId, idempotencyKey],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RecordPaymentInput>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues,
  });

  function openForm() {
    const key = crypto.randomUUID();
    setIdempotencyKey(key);
    reset({
      studentId,
      amount: undefined,
      method: "mobile_money",
      idempotencyKey: key,
      reference_number: "",
      paid_on: today(),
      notes: "",
    });
    setServerError(null);
    setOpen(true);
  }

  async function onSubmit(values: RecordPaymentInput) {
    setServerError(null);
    const result = await recordPaymentAction({
      ...values,
      amount: Number(values.amount),
      idempotencyKey: values.idempotencyKey || idempotencyKey,
    });
    if (result.error || !result.paymentId) {
      setServerError(result.error ?? "Could not record payment.");
      return;
    }
    setOpen(false);
    router.push(`/dashboard/payments/${result.paymentId}/receipt`);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="space-y-1">
        <Button type="button" onClick={openForm}>
          Record payment
        </Button>
        <p className="text-xs text-muted-foreground">
          Current balance: {formatKwacha(currentBalance)}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border p-4"
      noValidate
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Record payment</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Current balance: {formatKwacha(currentBalance)}. Partial payments are
        allowed. Mobile money and bank transfer only.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount (K)</Label>
          <Input
            id="amount"
            type="number"
            min={0.01}
            step="0.01"
            aria-invalid={Boolean(errors.amount)}
            {...register("amount", { valueAsNumber: true })}
          />
          {errors.amount ? (
            <p className="text-sm text-destructive">{errors.amount.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="method">Payment method</Label>
          <SelectNative id="method" {...register("method")}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reference_number">
            Reference (Airtel / bank slip no.)
          </Label>
          <Input id="reference_number" {...register("reference_number")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="paid_on">Payment date</Label>
          <Input
            id="paid_on"
            type="date"
            aria-invalid={Boolean(errors.paid_on)}
            {...register("paid_on")}
          />
          {errors.paid_on ? (
            <p className="text-sm text-destructive">{errors.paid_on.message}</p>
          ) : null}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" {...register("notes")} />
        </div>
      </div>

      <input type="hidden" {...register("studentId")} />
      <input type="hidden" {...register("idempotencyKey")} />

      {serverError ? (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save & print receipt"}
      </Button>
    </form>
  );
}
