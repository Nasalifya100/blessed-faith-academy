"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Progress({
  value = 0,
  className,
  "aria-label": ariaLabel,
  ...props
}: ComponentProps<"div"> & {
  value?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={ariaLabel ?? "Payment progress"}
      className={cn(
        "relative h-3 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full rounded-full bg-emerald-600 transition-[width] duration-500 ease-out dark:bg-emerald-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
