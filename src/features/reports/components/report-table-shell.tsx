import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Scrollable table shell with sticky header for report pages. */
export function ReportTableShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-h-[min(70vh,40rem)] overflow-auto rounded-xl border",
        className,
      )}
    >
      {children}
    </div>
  );
}
