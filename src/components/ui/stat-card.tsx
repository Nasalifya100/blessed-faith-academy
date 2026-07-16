import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "success" | "warning" | "danger" | "info";

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-800 dark:text-amber-200",
  danger: "text-red-700 dark:text-red-300",
  info: "text-sky-800 dark:text-sky-200",
};

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  className,
}: {
  title: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {Icon ? (
          <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl",
            VALUE_TONE[tone],
          )}
        >
          {value}
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <Card className="h-full shadow-sm transition-colors hover:bg-muted/30">
          {body}
        </Card>
      </Link>
    );
  }

  return (
    <Card className={cn("shadow-sm", className)}>
      {body}
    </Card>
  );
}
