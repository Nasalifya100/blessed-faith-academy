import { cn } from "@/lib/utils";

/** Sticky table header token — use on TableHeader across admin tables. */
export const stickyHeaderClass =
  "sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80";

/** Sticky form/action footer for long create/edit forms. */
export const stickyFormFooterClass =
  "sticky bottom-0 z-20 -mx-1 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80";

/** Full-bleed fixed footer (attendance register). */
export const fixedFormFooterClass =
  "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80";

/** Shared filter chrome used by staff/discipline-style toolbars. */
export function filterPanelClassName(className?: string) {
  return cn(
    "grid gap-3 rounded-xl border bg-muted/20 p-4 print:hidden sm:grid-cols-2 lg:grid-cols-4",
    className,
  );
}
