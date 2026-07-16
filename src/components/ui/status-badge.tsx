import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  danger:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({
  tone,
  children,
  className,
  label,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  /** Accessible name; defaults to children text when string */
  label?: string;
}) {
  const aria =
    label ?? (typeof children === "string" ? `Status: ${children}` : undefined);

  return (
    <Badge
      variant="outline"
      className={cn("font-medium", TONE_CLASS[tone], className)}
      aria-label={aria}
    >
      {children}
    </Badge>
  );
}

export { TONE_CLASS as statusToneClass };
