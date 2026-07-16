import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

export function PageShell({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "narrow" | "default" | "wide" | "form";
}) {
  const widthClass =
    width === "narrow"
      ? "max-w-3xl"
      : width === "form"
        ? "max-w-3xl"
        : width === "wide"
          ? "max-w-6xl"
          : "max-w-6xl";

  return (
    <div className={cn("mx-auto w-full space-y-6", widthClass, className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="space-y-2">
        {breadcrumb}
        {eyebrow ? (
          <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <div className="max-w-2xl text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function BackLink({
  href,
  children = "Back",
  className,
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}

export function SectionHeading({
  title,
  description,
  className,
}: {
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
