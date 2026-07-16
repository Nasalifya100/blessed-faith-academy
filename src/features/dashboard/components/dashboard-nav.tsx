"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { cn } from "@/lib/utils";

export interface DashboardNavLink {
  href: string;
  label: string;
}

export function DashboardNav({ links }: { links: DashboardNavLink[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-4"
    >
      {links.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-1.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "font-medium text-foreground underline underline-offset-4"
                : "text-muted-foreground hover:text-foreground hover:underline",
            )}
          >
            {link.label}
          </Link>
        );
      })}
      <SignOutButton />
    </nav>
  );
}

