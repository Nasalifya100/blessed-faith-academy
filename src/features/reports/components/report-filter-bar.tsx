import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared chrome for report filters — presentation only. */
export function ReportFilterBar({
  children,
  className,
  label = "Report filters",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm print:hidden sm:flex-row sm:flex-wrap sm:items-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ReportFilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-[10rem] flex-1 space-y-1.5 sm:max-w-xs", className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const reportFilterInputClass =
  "block h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
