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
import { previewPaymentApplication } from "@/features/fees/payment-preview";
import { formatKwacha } from "@/lib/money";
import { schoolToday } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { stickyFormFooterClass } from "@/components/ui/admin-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  /** Authoritative lifetime outstanding (all years). */
  outstandingBalance: number;
  broughtForwardOutstanding?: number;
  currentYearOutstanding?: number;
  availableCredit?: number;
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
  outstandingBalance,
  broughtForwardOutstanding = 0,
  currentYearOutstanding = 0,
  availableCredit = 0,
  studentName,
}: RecordPaymentFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmCreditOpen, setConfirmCreditOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<RecordPaymentInput | null>(
    null,
  );
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
      confirmCredit: false,
    }),
    [studentId, idempotencyKey],
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
  const preview = previewPaymentApplication({
    amountReceived: previewAmount,
    outstandingBalance,
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
      confirmCredit: false,
    });
    setServerError(null);
    setOpen(true);
  }

  async function submitPayment(
    values: RecordPaymentInput,
    confirmCredit: boolean,
  ) {
    setServerError(null);
    const result = await recordPaymentAction({
      ...values,
      amount: Number(values.amount),
      idempotencyKey: values.idempotencyKey || idempotencyKey,
      confirmCredit,
    });
    if (result.error || !result.paymentId) {
      setServerError(result.error ?? "Could not record payment.");
      return;
    }
    setOpen(false);
    setConfirmCreditOpen(false);
    setPendingValues(null);
    router.push(`/dashboard/payments/${result.paymentId}/receipt`);
    router.refresh();
  }

  async function onSubmit(values: RecordPaymentInput) {
    const amount = Number(values.amount);
    const nextPreview = previewPaymentApplication({
      amountReceived: amount,
      outstandingBalance,
    });
    if (nextPreview.createsCredit) {
      setPendingValues(values);
      setConfirmCreditOpen(true);
      return;
    }
    await submitPayment(values, false);
  }

  if (!open) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Record payment</CardTitle>
          <CardDescription>
            Capture mobile money or bank transfer. Amounts above the outstanding
            balance create available credit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Outstanding (all years)
              </p>
              <p
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  outstandingBalance > 0
                    ? "text-red-700 dark:text-red-300"
                    : "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {formatKwacha(outstandingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">Available credit</p>
              <p className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                {formatKwacha(availableCredit)}
              </p>
            </div>
          </div>
          {(broughtForwardOutstanding > 0 || currentYearOutstanding > 0) && (
            <p className="text-xs text-muted-foreground">
              Brought forward {formatKwacha(broughtForwardOutstanding)} · Current
              year {formatKwacha(currentYearOutstanding)}
            </p>
          )}
          <Button
            type="button"
            onClick={openForm}
            className="w-full gap-1.5 sm:w-auto"
            aria-label="Open record payment form"
          >
            <Banknote className="size-4" aria-hidden />
            Record payment
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
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
                Mobile money and bank transfer only. Full amount received is
                recorded; surplus becomes available credit.
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
                <p className="text-xs text-muted-foreground">
                  Outstanding (all years)
                </p>
                <p className="text-sm font-semibold tabular-nums text-red-700 dark:text-red-300">
                  {formatKwacha(outstandingBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available credit</p>
                <p className="text-sm font-semibold tabular-nums">
                  {formatKwacha(availableCredit)}
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
                    Amount received (K) <RequiredMark />
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    min={0.01}
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
                  <dt className="text-xs text-muted-foreground">
                    Amount received
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {previewAmount > 0 ? formatKwacha(preview.amountReceived) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Outstanding charges
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatKwacha(outstandingBalance)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Amount to be applied
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {previewAmount > 0 ? formatKwacha(preview.amountApplied) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Available credit created
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {previewAmount > 0
                      ? formatKwacha(preview.creditCreated)
                      : "—"}
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
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Outstanding after
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {previewAmount > 0
                      ? formatKwacha(preview.outstandingAfter)
                      : "—"}
                  </dd>
                </div>
              </dl>
              {preview.createsCredit ? (
                <p className="text-sm text-muted-foreground">
                  The unapplied amount will remain on the pupil’s account as
                  available credit.
                </p>
              ) : null}
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

      <ConfirmDialog
        open={confirmCreditOpen}
        title={
          preview.isAdvanceOnly ||
          (pendingValues != null &&
            previewPaymentApplication({
              amountReceived: Number(pendingValues.amount),
              outstandingBalance,
            }).isAdvanceOnly)
            ? "Record advance payment as credit?"
            : "Record payment with available credit?"
        }
        description={
          pendingValues
            ? (() => {
                const p = previewPaymentApplication({
                  amountReceived: Number(pendingValues.amount),
                  outstandingBalance,
                });
                return `Amount received ${formatKwacha(p.amountReceived)}. Applied to charges ${formatKwacha(p.amountApplied)}. Available credit created ${formatKwacha(p.creditCreated)}. The unapplied amount will remain on the pupil’s account as available credit.`;
              })()
            : "Confirm credit creation."
        }
        confirmLabel="Confirm & save"
        pending={isSubmitting}
        onCancel={() => {
          setConfirmCreditOpen(false);
          setPendingValues(null);
        }}
        onConfirm={() => {
          if (!pendingValues) return;
          void submitPayment(pendingValues, true);
        }}
      />
    </>
  );
}
