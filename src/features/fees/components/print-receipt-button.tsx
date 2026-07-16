"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PrintReceiptButton({
  className,
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(buttonVariants(), className)}
      onClick={() => window.print()}
      aria-label="Print receipt"
    >
      Print receipt
    </button>
  );
}

export function DownloadReceiptButton({
  className,
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      onClick={() => window.print()}
      aria-label="Download or save receipt as PDF via print dialog"
    >
      Download PDF
    </button>
  );
}
