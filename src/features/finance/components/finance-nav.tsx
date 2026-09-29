import Link from "next/link";

import type { StaffRole } from "@/features/auth/types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { financeNavItems } from "../presentation";

export function FinanceNav({
  role,
  current,
}: {
  role: StaffRole | null | undefined;
  current: string;
}) {
  const visible = financeNavItems(role);

  return (
    <nav
      aria-label="Finance sections"
      className="flex flex-wrap gap-2 print:hidden"
    >
      {visible.map((item) => {
        const isCurrent = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              buttonVariants({
                variant: isCurrent ? "default" : "outline",
                size: "sm",
              }),
              "min-h-11 px-3",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
