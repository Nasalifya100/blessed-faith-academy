"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ActionResult } from "../actions";

/**
 * The only correction path for a posted transaction. There is deliberately no
 * delete control anywhere in Finance.
 */
export function ReverseTransactionButton({
  id,
  label,
  description,
  onReverse,
}: {
  id: string;
  label: string;
  description: string;
  onReverse: (input: { reason: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await onReverse({ reason });
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
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`Reverse ${label}`}
      >
        <Undo2 className="size-3.5" aria-hidden />
        Reverse
      </Button>
    );
  }

  return (
    <div
      className="w-full max-w-sm space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-left"
      role="group"
      aria-label={`Confirm reversal of ${label}`}
    >
      <p className="text-xs text-muted-foreground">{description}</p>
      <p className="text-xs font-medium">
        The original record will remain in the audit history.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`reverse-reason-${id}`} className="text-xs">
          Reason <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`reverse-reason-${id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Recorded against the wrong account"
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
          disabled={isPending || reason.trim().length < 5}
          onClick={confirm}
        >
          {isPending ? "Reversing…" : "Confirm reversal"}
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
