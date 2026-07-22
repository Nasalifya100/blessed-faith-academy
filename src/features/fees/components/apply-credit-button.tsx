"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WalletCards } from "lucide-react";

import { applyAvailableCreditAction } from "@/features/fees/actions";
import { previewCreditApplication } from "@/features/fees/payment-preview";
import { formatKwacha } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ApplyCreditButtonProps {
  studentId: string;
  availableCredit: number;
  outstandingBalance: number;
}

export function ApplyCreditButton({
  studentId,
  availableCredit,
  outstandingBalance,
}: ApplyCreditButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (availableCredit <= 0 || outstandingBalance <= 0) {
    return null;
  }

  const preview = previewCreditApplication({
    availableCredit,
    outstandingBalance,
  });

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await applyAvailableCreditAction({
        studentId,
        confirm: true,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Apply available credit</CardTitle>
          <CardDescription>
            Allocate existing unapplied payments to outstanding charges
            (oldest credit and oldest charges first). Does not create a new
            payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Available credit</dt>
              <dd className="font-semibold tabular-nums">
                {formatKwacha(availableCredit)}
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
              <dt className="text-xs text-muted-foreground">Credit to apply</dt>
              <dd className="font-semibold tabular-nums">
                {formatKwacha(preview.creditToApply)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Remaining outstanding
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatKwacha(preview.remainingOutstanding)}
              </dd>
            </div>
          </dl>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => setOpen(true)}
          >
            <WalletCards className="size-4" aria-hidden />
            Apply available credit
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={open}
        title="Apply available credit?"
        description={`Apply ${formatKwacha(preview.creditToApply)} of available credit to outstanding charges. Remaining outstanding will be ${formatKwacha(preview.remainingOutstanding)}. Remaining credit will be ${formatKwacha(preview.remainingCredit)}.`}
        confirmLabel="Apply credit"
        pending={isPending}
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}
