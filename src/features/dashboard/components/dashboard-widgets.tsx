import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DashboardStatCard({
  title,
  value,
  description,
  href,
  tone = "default",
}: {
  title: string;
  value: string;
  description: string;
  href?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const mapped: StatTone =
    tone === "danger" ? "danger" : tone === "warning" ? "warning" : "default";

  return (
    <StatCard
      title={title}
      value={value}
      hint={description}
      tone={mapped}
      href={href}
    />
  );
}

export function DashboardQuickAction({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-colors group-hover:bg-muted/30">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

export function DashboardEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return <EmptyState title={title} description={description} size="sm" />;
}
