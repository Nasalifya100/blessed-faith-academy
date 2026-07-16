"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Banknote } from "lucide-react";

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
import { stickyFormFooterClass } from "@/components/ui/admin-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RecordPaymentFormProps {
  studentId: string;
  currentBalance: number;
  studentName?: string;
}

const today = () => schoolToday();

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      *
    </span>
  );
}

export function RecordPaymentForm({
  studentId,
  currentBalance,
  studentName,
}: RecordPaymentFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
      maxAmount: Math.max(0, currentBalance),
    }),
    [studentId, idempotencyKey, currentBalance],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RecordPaymentInput>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues,
  });

  const watchedAmount = useWatch({ control, name: "amount" });
  const watchedMethod = useWatch({ control, name: "method" });
  const watchedReference = useWatch({ control, name: "reference_number" });
  const watchedPaidOn = useWatch({ control, name: "paid_on" });

  const previewAmount =
    typeof watchedAmount === "number" && !Number.isNaN(watchedAmount)
      ? watchedAmount
      : 0;
  const remainingAfter =
    currentBalance > 0 ? Math.max(0, currentBalance - (previewAmount || 0)) : 0;

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
      maxAmount: Math.max(0, currentBalance),
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
      maxAmount: Math.max(0, currentBalance),
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
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Record payment</CardTitle>
          <CardDescription>
            Capture mobile money or bank transfer against the outstanding
            balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">Outstanding balance</p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                currentBalance > 0
                  ? "text-red-700 dark:text-red-300"
                  : "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {formatKwacha(currentBalance)}
            </p>
          </div>
          <Button
            type="button"
            onClick={openForm}
            disabled={currentBalance <= 0}
            className="w-full gap-1.5 sm:w-auto"
            aria-label="Open record payment form"
          >
            <Banknote className="size-4" aria-hidden />
            Record payment
          </Button>
          {currentBalance <= 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing outstanding — recording a payment is disabled.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="relative space-y-4 pb-24"
      noValidate
    >
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Record payment</CardTitle>
            <CardDescription>
              Mobile money and bank transfer only. Amount cannot exceed the
              outstanding balance.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <section
            aria-label="Student balance summary"
            className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3"
          >
            <div>
              <p className="text-xs text-muted-foreground">Student</p>
              <p className="text-sm font-medium">
                {studentName ?? "Selected student"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-sm font-semibold tabular-nums text-red-700 dark:text-red-300">
                {formatKwacha(currentBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">After this payment</p>
              <p className="text-sm font-semibold tabular-nums">
                {formatKwacha(remainingAfter)}
              </p>
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="payment-details-heading">
            <h4
              id="payment-details-heading"
              className="text-sm font-semibold tracking-tight"
            >
              Payment details
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">
                  Amount (K) <RequiredMark />
                </Label>
                <Input
                  id="amount"
                  type="number"
                  min={0.01}
                  max={currentBalance > 0 ? currentBalance : undefined}
                  step="0.01"
                  aria-invalid={Boolean(errors.amount)}
                  {...register("amount", { valueAsNumber: true })}
                />
                {errors.amount ? (
                  <p className="text-sm text-destructive">
                    {errors.amount.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="method">
                  Payment method <RequiredMark />
                </Label>
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
                <Input
                  id="reference_number"
                  {...register("reference_number")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="paid_on">
                  Payment date <RequiredMark />
                </Label>
                <Input
                  id="paid_on"
                  type="date"
                  aria-invalid={Boolean(errors.paid_on)}
                  {...register("paid_on")}
                />
                {errors.paid_on ? (
                  <p className="text-sm text-destructive">
                    {errors.paid_on.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input id="notes" {...register("notes")} />
              </div>
            </div>
          </section>

          <section
            aria-label="Payment preview"
            className="space-y-2 rounded-xl border border-dashed p-4"
          >
            <h4 className="text-sm font-semibold tracking-tight">
              Payment preview
            </h4>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="font-semibold tabular-nums">
                  {previewAmount > 0 ? formatKwacha(previewAmount) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Method</dt>
                <dd>
                  {(PAYMENT_METHOD_LABELS as Record<string, string>)[
                    watchedMethod ?? "mobile_money"
                  ] ?? watchedMethod}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reference</dt>
                <dd>{watchedReference?.trim() ? watchedReference : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date</dt>
                <dd>{watchedPaidOn || "—"}</dd>
              </div>
            </dl>
          </section>

          <input type="hidden" {...register("studentId")} />
          <input type="hidden" {...register("idempotencyKey")} />

          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className={stickyFormFooterClass}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Saving opens the printable receipt. Idempotent retries reuse the
            same key.
          </p>
          <Button
            type="submit"
            disabled={isSubmitting}
            size="lg"
            className="gap-1.5 sm:min-w-52"
          >
            <Banknote className="size-4" aria-hidden />
            {isSubmitting ? "Saving…" : "Save & print receipt"}
          </Button>
        </div>
      </div>
    </form>
  );
}
