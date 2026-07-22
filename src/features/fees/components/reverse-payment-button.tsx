"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";

import { voidPaymentAction } from "@/features/fees/actions";
import { formatKwacha } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReversePaymentButtonProps {
  paymentId: string;
  studentId: string;
  receiptNumber: string;
}

interface VoidPreview {
  allocationsToReverse: number;
  creditToRemove: number;
  outstandingAfter: number;
  availableCreditAfter: number;
}

export function ReversePaymentButton({
  paymentId,
  studentId,
  receiptNumber,
}: ReversePaymentButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VoidPreview | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadPreview() {
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc(
        "get_void_payment_preview",
        { p_payment_id: paymentId },
      );
      if (rpcError) {
        setError(rpcError.message);
        setPreview(null);
        return;
      }
      const row = (data ?? {}) as Record<string, unknown>;
      setPreview({
        allocationsToReverse: Number(row.allocations_to_reverse ?? 0),
        creditToRemove: Number(row.credit_to_remove ?? 0),
        outstandingAfter: Number(row.outstanding_after_estimate ?? 0),
        availableCreditAfter: Number(row.available_credit_after_estimate ?? 0),
      });
    } catch {
      setPreview(null);
    }
  }

  function onOpen() {
    setOpen(true);
    void loadPreview();
  }

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await voidPaymentAction({
        paymentId,
        studentId,
        reason,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      setPreview(null);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={onOpen}
        aria-label={`Reverse payment ${receiptNumber}`}
      >
        <Undo2 className="size-3.5" aria-hidden />
        Reverse payment
      </Button>
    );
  }

  return (
    <div
      className="w-full max-w-sm space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-left"
      role="group"
      aria-label={`Confirm reverse for ${receiptNumber}`}
    >
      <p className="text-xs text-muted-foreground">
        Reverse <span className="font-mono">{receiptNumber}</span>? The
        original receipt stays on file as voided and does not count toward the
        balance.
      </p>
      {preview ? (
        <dl className="grid gap-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt>Allocations reversed</dt>
            <dd className="tabular-nums">
              {formatKwacha(preview.allocationsToReverse)}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Credit removed</dt>
            <dd className="tabular-nums">
              {formatKwacha(preview.creditToRemove)}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Outstanding after</dt>
            <dd className="tabular-nums">
              {formatKwacha(preview.outstandingAfter)}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Available credit after</dt>
            <dd className="tabular-nums">
              {formatKwacha(preview.availableCreditAfter)}
            </dd>
          </div>
        </dl>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`void-reason-${paymentId}`} className="text-xs">
          Reason <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`void-reason-${paymentId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Recorded in error"
          disabled={isPending}
          aria-required="true"
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isPending || reason.trim().length < 3}
          onClick={onConfirm}
        >
          {isPending ? "Reversing…" : "Confirm reverse"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
            setPreview(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
