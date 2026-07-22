import { CheckCircle2, CircleAlert, CircleDashed, Wallet } from "lucide-react";

import {
  financeModeLabel,
  type FinanceAllocationMigrationStatus,
} from "@/features/fees/migration-status";
import { formatKwacha } from "@/lib/money";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readinessTone(ready: boolean): StatusTone {
  return ready ? "success" : "warning";
}

function backfillLabel(status: FinanceAllocationMigrationStatus["backfillStatus"]) {
  if (status === "completed") return "Completed";
  if (status === "unavailable") return "Unavailable";
  return "Not started";
}

function validationLabel(
  status: FinanceAllocationMigrationStatus["validationStatus"],
) {
  if (status === "ok") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "recorded") return "Recorded";
  return "Not run";
}

export function FinanceMigrationStatusPanel({
  status,
  error,
}: {
  status: FinanceAllocationMigrationStatus | null;
  error: string | null;
}) {
  if (error) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Finance migration status</CardTitle>
          <CardDescription>
            Read-only readiness check for payment allocations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return null;
  }

  const modeTone: StatusTone =
    status.financeMode === "allocation_enabled" ? "success" : "neutral";

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" aria-hidden />
            Current finance mode
          </CardTitle>
          <CardDescription>
            Allocation mode is enabled only after controlled backfill,
            validation, and activation. This page never activates the migration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusBadge tone={modeTone}>
            {financeModeLabel(status.financeMode)}
          </StatusBadge>
          {!status.statusCheckerAvailable ? (
            <p className="text-sm text-muted-foreground">
              Status checker migration is not installed yet. Finance remains in
              Legacy mode until Phase 2 migrations are applied on this
              environment.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment allocation readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge tone={readinessTone(status.paymentAllocationReadiness)}>
              {status.paymentAllocationReadiness ? "Ready" : "Not ready"}
            </StatusBadge>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Available credit readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge tone={readinessTone(status.availableCreditReadiness)}>
              {status.availableCreditReadiness ? "Ready" : "Not ready"}
            </StatusBadge>
            <p className="mt-2 text-xs text-muted-foreground">
              Credit is ready only after allocation mode is enabled.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
          <CardDescription>
            Staging verification signals. Blocking issues must be resolved before
            any production backfill.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            <ChecklistRow
              ok={status.allocationSchemaInstalled}
              label="Allocation schema installed"
            />
            <ChecklistRow
              ok={status.diagnosticsAvailable}
              label="Diagnostics available"
            />
            <ChecklistRow
              ok={
                status.diagnosticsAvailable &&
                !status.diagnosticError &&
                status.blockingIssueCount === 0
              }
              label={`Diagnostics clear (${status.blockingIssueCount} blocking · ${status.warningCount} warnings)`}
            />
            <ChecklistRow
              ok={status.backfillStatus === "completed"}
              label={`Backfill status: ${backfillLabel(status.backfillStatus)}`}
            />
            <ChecklistRow
              ok={
                status.validationStatus === "ok" ||
                status.validationStatus === "recorded"
              }
              label={`Validation status: ${validationLabel(status.validationStatus)}`}
            />
            <ChecklistRow
              ok={status.activationStatus === "enabled"}
              label={`Activation status: ${
                status.activationStatus === "enabled" ? "Enabled" : "Legacy"
              }`}
            />
          </ul>
        </CardContent>
      </Card>

      {status.diagnosticResult ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Diagnostic summary</CardTitle>
            <CardDescription>
              Counts only — no pupil lists, SQL, or credentials are shown.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <Metric
                label="Safe to backfill"
                value={
                  status.diagnosticResult.safeToBackfill ? "Yes" : "No"
                }
              />
              <Metric
                label="Blocking issues"
                value={String(status.diagnosticResult.blockingIssueCount)}
              />
              <Metric
                label="Warnings"
                value={String(status.diagnosticResult.warningCount)}
              />
              <Metric
                label="Completed payments"
                value={String(status.diagnosticResult.completedPaymentsCount)}
              />
              <Metric
                label="Voided payments"
                value={String(status.diagnosticResult.voidedPaymentsCount)}
              />
              <Metric
                label="Active charges"
                value={String(status.diagnosticResult.activeChargesCount)}
              />
              <Metric
                label="Total completed payments"
                value={formatKwacha(
                  status.diagnosticResult.totalCompletedPayments,
                )}
              />
              <Metric
                label="Total active charges"
                value={formatKwacha(status.diagnosticResult.totalActiveCharges)}
              />
            </dl>
            {status.diagnosticError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                Diagnostics could not complete.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Timestamps</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <Metric
              label="Migration / gate updated"
              value={formatTimestamp(status.gateUpdatedAt)}
            />
            <Metric
              label="Last validation"
              value={formatTimestamp(status.invariantsOkAt)}
            />
            <Metric
              label="Activated at"
              value={formatTimestamp(status.activatedAt)}
            />
            <Metric
              label="Activated by"
              value={status.activatedByName ?? "—"}
            />
            <Metric
              label="Diagnostics OK at"
              value={formatTimestamp(status.diagnosticsOkAt)}
            />
            <Metric
              label="Status checked at"
              value={formatTimestamp(status.checkedAt)}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function ChecklistRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
          aria-hidden
        />
      ) : (
        <CircleDashed
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span>{label}</span>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function FinanceMigrationAccessDenied() {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleAlert className="size-5" aria-hidden />
          Access restricted
        </CardTitle>
        <CardDescription>
          Only Administrators can view finance migration readiness.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
