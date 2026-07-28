import Link from "next/link";
import { redirect } from "next/navigation";

import { ReportCardSettingsForm } from "@/features/report-cards/components/report-card-settings-form";
import { canManageReportCardSettings } from "@/features/report-cards/permissions";
import { getReportCardsHubContext } from "@/features/report-cards/queries";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReportCardSettingsPage() {
  const current = await getCurrentUser();
  if (
    !current?.profile ||
    !canManageReportCardSettings(current.profile.role)
  ) {
    redirect("/dashboard");
  }

  const hub = await getReportCardsHubContext();
  if (!hub) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Report card settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure the official template defaults. Academic values always
            come from Phase 2D.1 result snapshots.
          </p>
        </div>
        <Link
          href="/dashboard/report-cards"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to report cards
        </Link>
      </div>
      <ReportCardSettingsForm settings={hub.settings} />
    </div>
  );
}
