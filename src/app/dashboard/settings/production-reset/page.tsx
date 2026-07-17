import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canRunProductionReset,
  isProductionResetEnvEnabled,
} from "@/features/auth/permissions";
import { ProductionResetPanel } from "@/features/system/components/production-reset-panel";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

export default async function ProductionResetPage() {
  const current = await getCurrentUser();
  if (!canRunProductionReset(current?.profile?.role)) {
    redirect("/dashboard/settings");
  }

  const enabled = isProductionResetEnvEnabled();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="Production Reset"
        description="This permanently removes test operational data while preserving staff, authentication, school configuration, academic setup, fee setup, and system settings."
        breadcrumb={
          <BackLink href="/dashboard/settings">Back to settings</BackLink>
        }
      />
      <ProductionResetPanel enabled={enabled} />
    </PageShell>
  );
}
