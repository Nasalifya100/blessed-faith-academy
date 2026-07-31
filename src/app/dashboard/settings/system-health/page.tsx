import { redirect } from "next/navigation";
import { Activity, ShieldCheck } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getDeepSystemHealth } from "@/features/ops/health";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { StatusBadge } from "@/components/ui/status-badge";
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
import type { HealthStatus } from "@/lib/ops/health-status";

function toneFor(status: HealthStatus): "success" | "warning" | "danger" | "neutral" | "info" {
  switch (status) {
    case "Healthy":
      return "success";
    case "Warning":
      return "warning";
    case "Action required":
    case "Unavailable":
      return "danger";
    case "Unknown":
      return "neutral";
    default:
      return "info";
  }
}

export default async function SystemHealthPage() {
  const current = await getCurrentUser();
  if (
    !(
      current?.profile?.is_active &&
      current.profile.role === "administrator" &&
      current.profile.school_id
    )
  ) {
    redirect("/dashboard");
  }

  const report = await getDeepSystemHealth({
    actorId: current.id,
    schoolId: current.profile.school_id,
  });

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="System health"
        description="Operational readiness for the live Blessed Faith Academy deployment. Secrets and database internals are never shown here."
        breadcrumb={
          <BackLink href="/dashboard/settings">Back to settings</BackLink>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={toneFor(report.overall)}>
          Overall: {report.overall}
        </StatusBadge>
        <p className="text-sm text-muted-foreground">
          Checked {new Date(report.checkedAt).toLocaleString()}
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden />
            Deployment identity
          </CardTitle>
          <CardDescription>
            Use these values when reporting support incidents so operators know
            which release is running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Application version</dt>
              <dd className="font-medium">{report.deployment.applicationVersion}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Environment</dt>
              <dd className="font-medium">{report.deployment.environmentName}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Commit</dt>
              <dd className="font-mono text-sm">{report.deployment.gitShaShort}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Build timestamp</dt>
              <dd className="font-mono text-sm">{report.deployment.buildTimestamp}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Worker name</dt>
              <dd className="font-medium">{report.deployment.workerName}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Public health</dt>
              <dd className="font-medium">
                <a className="underline" href="/api/health">
                  /api/health
                </a>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5 text-muted-foreground" aria-hidden />
            Subsystems
          </CardTitle>
          <CardDescription>
            Backup status stays Unknown until confirmed outside the app. Do not
            treat Unknown as Healthy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.subsystems.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>
                      <StatusBadge tone={toneFor(row.status)}>
                        {row.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.summary}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Known operational limitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The Worker is named staging but is the school&apos;s effective
            production environment.
          </p>
          <p>
            Rate limits are best-effort per Worker isolate and fail open if the
            in-memory store is unavailable.
          </p>
          <p>
            File uploads are not part of this release; storage health remains
            Unknown by design.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
