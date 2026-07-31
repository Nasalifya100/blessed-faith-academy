import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  listOperationalAudits,
  type AuditModule,
} from "@/features/ops/audit-queries";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

const MODULES: Array<{ id: AuditModule | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "academic", label: "Academic" },
  { id: "finance", label: "Finance" },
  { id: "report_card", label: "Report cards" },
  { id: "password_reset", label: "Password reset" },
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (
    !(
      current?.profile?.is_active &&
      (role === "administrator" || role === "headteacher")
    )
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const moduleParam = firstValue(params.module) || "all";
  const eventType = firstValue(params.event) || undefined;
  const actorId = firstValue(params.actor) || undefined;
  const from = firstValue(params.from) || undefined;
  const to = firstValue(params.to) || undefined;
  const page = Number(firstValue(params.page) || "1");
  const outcomeRaw = firstValue(params.outcome);
  const outcome =
    outcomeRaw === "success" || outcomeRaw === "failure"
      ? outcomeRaw
      : "all";

  const moduleFilter = MODULES.some((m) => m.id === moduleParam)
    ? (moduleParam as AuditModule | "all")
    : "all";

  const result = await listOperationalAudits({
    module: moduleFilter,
    eventType,
    actorId,
    from,
    to,
    page,
    outcome,
    pageSize: 25,
  });

  function hrefFor(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const merged = {
      module: moduleFilter,
      event: eventType,
      actor: actorId,
      from,
      to,
      outcome: outcome === "all" ? undefined : outcome,
      page: String(page),
      ...next,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) sp.set(k, v);
    }
    const qs = sp.toString();
    return qs
      ? `/dashboard/settings/audit-log?${qs}`
      : "/dashboard/settings/audit-log";
  }

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Audit log"
        description="Read-only operational history. Records cannot be edited or deleted from this screen."
        breadcrumb={
          <BackLink href="/dashboard/settings">Back to settings</BackLink>
        }
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Amounts, student names, and full JSON payloads are intentionally
            omitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {MODULES.map((m) => (
              <Link
                key={m.id}
                href={hrefFor({ module: m.id, page: "1" })}
                className={cn(
                  buttonVariants({
                    variant: moduleFilter === m.id ? "default" : "outline",
                    size: "sm",
                  }),
                  "min-h-10",
                )}
              >
                {m.label}
              </Link>
            ))}
          </div>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
            <input type="hidden" name="module" value={moduleFilter} />
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Event type</span>
              <input
                name="event"
                defaultValue={eventType ?? ""}
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Actor id</span>
              <input
                name="actor"
                defaultValue={actorId ?? ""}
                className="flex h-10 w-full rounded-md border bg-background px-3 font-mono text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">From (ISO)</span>
              <input
                name="from"
                defaultValue={from ?? ""}
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">To (ISO)</span>
              <input
                name="to"
                defaultValue={to ?? ""}
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <div className="flex items-end gap-2 sm:col-span-2">
              <button
                type="submit"
                className={cn(buttonVariants({ variant: "default" }), "min-h-10")}
              >
                Apply
              </button>
              <Link
                href="/dashboard/settings/audit-log"
                className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}
              >
                Clear
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Page {result.page} · {result.fetched} shown
            {result.hasMore ? " · more available" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit events match.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <TableRow key={`${item.module}-${item.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{item.module}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.eventType}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            item.outcome === "failure" ? "danger" : "success"
                          }
                        >
                          {item.outcome}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.actorId ? item.actorId.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.resourceId ? item.resourceId.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.summary}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Link
              href={hrefFor({ page: String(Math.max(1, page - 1)) })}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "min-h-10",
                page <= 1 && "pointer-events-none opacity-50",
              )}
            >
              Previous
            </Link>
            <Link
              href={hrefFor({ page: String(page + 1) })}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "min-h-10",
                !result.hasMore && "pointer-events-none opacity-50",
              )}
            >
              Next
            </Link>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
