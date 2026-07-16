import type { ReactNode } from "react";
import { FileQuestion } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  icon,
  size = "md",
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card text-center shadow-sm",
        size === "sm" && "px-4 py-8",
        size === "md" && "px-6 py-14",
        size === "lg" && "px-6 py-16",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted sm:size-14">
        {icon ?? (
          <FileQuestion className="size-6 text-muted-foreground" aria-hidden />
        )}
      </span>
      <div className="space-y-1">
        <p
          className={cn(
            "font-semibold tracking-tight",
            size === "lg" ? "text-lg" : "text-sm",
            size === "lg" && "sm:text-lg",
          )}
        >
          {title}
        </p>
        {description ? (
          <div className="max-w-md text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}
