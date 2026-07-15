"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { voidPaymentAction } from "@/features/fees/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReversePaymentButtonProps {
  paymentId: string;
  studentId: string;
  receiptNumber: string;
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
  const [isPending, startTransition] = useTransition();

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
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Reverse
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-left">
      <p className="text-xs text-muted-foreground">
        Reverse {receiptNumber}? The original receipt stays on file as voided.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`void-reason-${paymentId}`} className="text-xs">
          Reason (required)
        </Label>
        <Input
          id={`void-reason-${paymentId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Recorded in error"
          disabled={isPending}
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
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
