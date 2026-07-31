/**
 * Health-check status mapping and public response redaction.
 */

export type HealthStatus =
  | "Healthy"
  | "Warning"
  | "Action required"
  | "Unavailable"
  | "Unknown";

export type SubsystemCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  summary: string;
};

const INTERNAL_LEAK =
  /\b(qaczvlbgsxcrdcdgsfpo|supabase\.co|postgres|SQLSTATE|service_role|PGRST|rpc_|gen_random|migration_\d+)\b/i;

export function redactHealthDetail(text: string): string {
  if (!text) return text;
  if (INTERNAL_LEAK.test(text)) {
    return "Details withheld for security.";
  }
  return text.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    "[id]",
  );
}

export function mapConnectivityToStatus(ok: boolean | null): HealthStatus {
  if (ok === null) return "Unknown";
  return ok ? "Healthy" : "Unavailable";
}

export function mapBackupStatus(
  configured: boolean | null,
): HealthStatus {
  if (configured === null) return "Unknown";
  return configured ? "Warning" : "Action required";
}

/** Aggregate worst status for a dashboard rollup. */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  const rank: Record<HealthStatus, number> = {
    Healthy: 0,
    Warning: 1,
    Unknown: 2,
    "Action required": 3,
    Unavailable: 4,
  };
  let worst: HealthStatus = "Healthy";
  for (const s of statuses) {
    if (rank[s] > rank[worst]) worst = s;
  }
  return worst;
}

export function isPublicHealthSafe(payload: unknown): boolean {
  const text = JSON.stringify(payload);
  return !INTERNAL_LEAK.test(text) && !/stack|trace|secret|password/i.test(text);
}
