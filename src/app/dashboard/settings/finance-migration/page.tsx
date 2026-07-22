import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canViewFinanceMigrationStatus } from "@/features/auth/permissions";
import { getFinanceAllocationMigrationStatus } from "@/features/fees/queries-migration-status";
import {
  FinanceMigrationAccessDenied,
  FinanceMigrationStatusPanel,
} from "@/features/fees/components/finance-migration-status-panel";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

export default async function FinanceMigrationStatusPage() {
  const current = await getCurrentUser();
  if (!canViewFinanceMigrationStatus(current?.profile?.role)) {
    redirect("/dashboard/settings");
  }

  const { allowed, status, error } =
    await getFinanceAllocationMigrationStatus();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="Finance migration readiness"
        description="Read-only Phase 2 payment allocation checklist for staging verification. This page does not activate allocations, run backfill, or change payment behaviour."
        breadcrumb={
          <BackLink href="/dashboard/settings">Back to settings</BackLink>
        }
      />
      {!allowed ? (
        <FinanceMigrationAccessDenied />
      ) : (
        <FinanceMigrationStatusPanel status={status} error={error} />
      )}
    </PageShell>
  );
}
