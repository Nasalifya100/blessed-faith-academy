import Link from "next/link";

import type { StaffRole } from "@/features/auth/types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { hasFinanceCapability, type FinanceCapability } from "../capabilities";

interface FinanceNavItem {
  href: string;
  label: string;
  capability: FinanceCapability;
}

const ITEMS: FinanceNavItem[] = [
  { href: "/dashboard/finance", label: "Overview", capability: "FINANCE_VIEW" },
  {
    href: "/dashboard/fees",
    label: "School Fees",
    capability: "FINANCE_VIEW",
  },
  {
    href: "/dashboard/finance/funds",
    label: "Funds",
    capability: "FINANCE_FUNDS_VIEW",
  },
  {
    href: "/dashboard/finance/expenses",
    label: "Expenses",
    capability: "FINANCE_EXPENSE_RECORD",
  },
  {
    href: "/dashboard/finance/petty-cash",
    label: "Petty Cash",
    capability: "FINANCE_ACCOUNTS_VIEW",
  },
  {
    href: "/dashboard/finance/salaries",
    label: "Salaries",
    capability: "FINANCE_SALARY_VIEW",
  },
  {
    href: "/dashboard/finance/accounts",
    label: "Accounts",
    capability: "FINANCE_ACCOUNTS_VIEW",
  },
  {
    href: "/dashboard/finance/transfers",
    label: "Transfers",
    capability: "FINANCE_ACCOUNTS_VIEW",
  },
  {
    href: "/dashboard/finance/reports",
    label: "Reports",
    capability: "FINANCE_REPORTS_VIEW",
  },
];

export function FinanceNav({
  role,
  current,
}: {
  role: StaffRole | null | undefined;
  current: string;
}) {
  const visible = ITEMS.filter((item) =>
    hasFinanceCapability(role, item.capability),
  );

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
              "min-h-10",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
