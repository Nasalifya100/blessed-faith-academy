import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDeploymentMetadata } from "@/lib/ops/deployment-metadata";
import {
  mapBackupStatus,
  mapConnectivityToStatus,
  redactHealthDetail,
  worstStatus,
  type HealthStatus,
  type SubsystemCheck,
} from "@/lib/ops/health-status";
import { logOpsEvent, createCorrelationId } from "@/lib/ops/logger";

export type DeepHealthReport = {
  overall: HealthStatus;
  checkedAt: string;
  deployment: ReturnType<typeof getDeploymentMetadata>;
  subsystems: SubsystemCheck[];
};

async function probeTable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
): Promise<boolean> {
  const { error } = await supabase.from(table).select("id").limit(1);
  return !error;
}

/**
 * Administrator deep health check. Never returns secrets, SQL, or project refs.
 */
export async function getDeepSystemHealth(input: {
  actorId: string;
  schoolId: string;
}): Promise<DeepHealthReport> {
  const correlationId = createCorrelationId();
  const started = Date.now();
  const deployment = getDeploymentMetadata();
  const subsystems: SubsystemCheck[] = [];

  let supabaseOk: boolean | null = null;
  try {
    const supabase = await createSupabaseServerClient();

    const { data: schoolRow, error: schoolError } = await supabase
      .from("schools")
      .select("id")
      .eq("id", input.schoolId)
      .maybeSingle();
    supabaseOk = !schoolError && Boolean(schoolRow?.id);
    subsystems.push({
      id: "database",
      label: "Database connectivity",
      status: mapConnectivityToStatus(supabaseOk),
      summary: supabaseOk
        ? "Authenticated query succeeded."
        : schoolError
          ? "Could not complete an authenticated database query."
          : "School record was not readable for this session.",
    });

    const { data: year, error: yearError } = await supabase
      .from("academic_years")
      .select("id, name")
      .eq("is_current", true)
      .maybeSingle();
    subsystems.push({
      id: "academic-year",
      label: "Current academic year",
      status: yearError
        ? "Unavailable"
        : year?.id
          ? "Healthy"
          : "Action required",
      summary: yearError
        ? "Unable to read academic year configuration."
        : year?.id
          ? "A current academic year is configured."
          : "No current academic year is marked.",
    });

    const tables = [
      { id: "students-table", table: "students", label: "Students records" },
      {
        id: "report-cards-table",
        table: "student_report_cards",
        label: "Report card records",
      },
      {
        id: "result-snapshots-table",
        table: "student_exam_result_snapshots",
        label: "Result snapshot records",
      },
      {
        id: "academic-audit-stream",
        table: "academic_event_audits",
        label: "Academic audit stream",
      },
      {
        id: "finance-audit-stream",
        table: "finance_event_audits",
        label: "Finance audit stream",
      },
    ] as const;

    for (const t of tables) {
      const ok = await probeTable(supabase, t.table);
      subsystems.push({
        id: t.id,
        label: t.label,
        status: ok ? "Healthy" : "Action required",
        summary: ok
          ? "Readable under current session."
          : "Not readable — check migrations, RLS, or grants.",
      });
    }

    const { count: auditCount, error: auditError } = await supabase
      .from("academic_event_audits")
      .select("id", { count: "exact", head: true });
    subsystems.push({
      id: "audit-volume",
      label: "Audit subsystem",
      status: auditError ? "Warning" : "Healthy",
      summary: auditError
        ? "Audit query failed."
        : `Academic audit stream reachable (${typeof auditCount === "number" ? auditCount : "n/a"} rows visible).`,
    });

    // Storage: no buckets in schema yet.
    subsystems.push({
      id: "storage",
      label: "Object storage",
      status: "Unknown",
      summary:
        "No school file-storage buckets are configured in this release.",
    });

    subsystems.push({
      id: "backup",
      label: "Backup posture",
      status: mapBackupStatus(null),
      summary:
        "Backup success is not verified by the application. Confirm Supabase plan backups / PITR in the dashboard.",
    });

    subsystems.push({
      id: "report-card-readiness",
      label: "Report-card readiness",
      status: (await probeTable(supabase, "student_report_cards"))
        ? "Healthy"
        : "Action required",
      summary: "Report-card tables must remain readable for publishing workflows.",
    });
  } catch (err) {
    supabaseOk = false;
    subsystems.push({
      id: "database",
      label: "Database connectivity",
      status: "Unavailable",
      summary: redactHealthDetail(
        err instanceof Error ? err.message : "Unexpected health probe failure.",
      ),
    });
    logOpsEvent({
      severity: "error",
      correlationId,
      action: "deep_health_check",
      module: "ops",
      outcome: "failure",
      actorId: input.actorId,
      schoolId: input.schoolId,
      errorCategory: "DEPENDENCY_UNAVAILABLE",
      durationMs: Date.now() - started,
      message: "Deep health check failed",
    });
  }

  const overall = worstStatus(subsystems.map((s) => s.status));

  logOpsEvent({
    severity: overall === "Healthy" || overall === "Warning" ? "info" : "warn",
    correlationId,
    action: "deep_health_check",
    module: "ops",
    outcome: "success",
    actorId: input.actorId,
    schoolId: input.schoolId,
    durationMs: Date.now() - started,
    meta: { overall, subsystemCount: subsystems.length },
  });

  return {
    overall,
    checkedAt: new Date().toISOString(),
    deployment,
    subsystems: subsystems.map((s) => ({
      ...s,
      summary: redactHealthDetail(s.summary),
    })),
  };
}
