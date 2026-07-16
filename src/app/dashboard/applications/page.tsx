import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Plus } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canManageApplications } from "@/features/auth/permissions";
import { listApplications } from "@/features/applications/queries";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
} from "@/features/applications/schemas";
import { ApplicationsWorkspace } from "@/features/applications/components/applications-workspace";
import { getCurrentYearClasses } from "@/features/students/queries";
import { PageHeader, PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildHref(status: string | null): string {
  if (status === null) return "/dashboard/applications";
  const sp = new URLSearchParams();
  sp.set("status", status);
  return `/dashboard/applications?${sp.toString()}`;
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const statusFilterUnset = params.status === undefined;
  const statusParam = firstValue(params.status);
  const status = statusFilterUnset ? "submitted" : statusParam;
  const showingAll = !statusFilterUnset && status === "";

  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!canManageApplications(role)) {
    redirect("/dashboard");
  }

  const [applications, pendingQueue, { classes }] = await Promise.all([
    listApplications(showingAll ? undefined : status || undefined),
    listApplications("submitted"),
    getCurrentYearClasses(),
  ]);

  const pendingCount = pendingQueue.length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admissions"
        title="Applications"
        description={
          <>
            <span className="font-medium text-foreground">
              {applications.length}
            </span>{" "}
            in this queue
            {" · "}
            <span className="font-medium text-foreground">{pendingCount}</span>{" "}
            pending approval
          </>
        }
        actions={
          <Link
            href="/dashboard/applications/new"
            className={cn(buttonVariants(), "gap-2")}
          >
            <Plus className="size-4" aria-hidden />
            New application
          </Link>
        }
      />

      <section
        aria-label="Status filters"
        className="flex flex-wrap gap-2 rounded-xl border bg-card p-3 shadow-sm"
      >
        <Link
          href={buildHref("")}
          className={cn(
            buttonVariants({
              variant: showingAll ? "default" : "outline",
              size: "sm",
            }),
            "rounded-full",
          )}
          aria-current={showingAll ? "page" : undefined}
        >
          All
        </Link>
        {APPLICATION_STATUSES.filter((value) => value !== "withdrawn").map(
          (value) => {
            const isActive =
              !showingAll &&
              ((statusFilterUnset && value === "submitted") ||
                status === value);
            return (
              <Link
                key={value}
                href={buildHref(value)}
                className={cn(
                  buttonVariants({
                    variant: isActive ? "default" : "outline",
                    size: "sm",
                  }),
                  "rounded-full",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                {APPLICATION_STATUS_LABELS[value]}
                {value === "submitted" ? (
                  <span className="ml-1.5 rounded-full bg-background/20 px-1.5 text-xs tabular-nums">
                    {pendingCount}
                  </span>
                ) : null}
              </Link>
            );
          },
        )}
      </section>

      {applications.length === 0 ? (
        <EmptyState
          size="lg"
          title="No applications in this queue"
          description="Start a new application, or switch status filters to review other queues."
          icon={
            <ClipboardList
              className="size-7 text-muted-foreground"
              aria-hidden
            />
          }
          action={
            <Link
              href="/dashboard/applications/new"
              className={cn(buttonVariants(), "gap-2")}
            >
              <Plus className="size-4" aria-hidden />
              New application
            </Link>
          }
        />
      ) : (
        <ApplicationsWorkspace
          applications={applications}
          classOptions={classes}
        />
      )}
    </PageShell>
  );
}
