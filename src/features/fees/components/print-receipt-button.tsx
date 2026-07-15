"use client";

import { buttonVariants } from "@/components/ui/button";

export function PrintReceiptButton() {
  return (
    <button
      type="button"
      className={buttonVariants()}
      onClick={() => window.print()}
    >
      Print receipt
    </button>
  );
}
