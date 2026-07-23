"use client";

import { Button } from "@/components/ui/button";

export function PrintTimetableButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 print:hidden"
      onClick={() => window.print()}
    >
      Print
    </Button>
  );
}
