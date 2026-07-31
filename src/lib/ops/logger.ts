/**
 * Structured application logging for Cloudflare Workers.
 * Avoid Node-only transports; console JSON is Workers-compatible.
 */

import { createIncidentId, isSensitiveSqlLeak, type OpsErrorCategory } from "@/lib/ops/errors";

export type LogSeverity = "debug" | "info" | "warn" | "error";

export type StructuredLogEvent = {
  timestamp: string;
  severity: LogSeverity;
  correlationId: string;
  action: string;
  module: string;
  outcome: "success" | "failure" | "denied" | "skipped";
  actorId?: string;
  schoolId?: string;
  resourceId?: string;
  durationMs?: number;
  errorCategory?: OpsErrorCategory;
  message?: string;
  /** Extra non-PII fields only. */
  meta?: Record<string, string | number | boolean | null>;
};

const SENSITIVE_KEY =
  /password|token|cookie|authorization|service.?role|secret|api.?key|medical|mark|payload|receipt|guardian.?phone|national.?id/i;

export function scrubLogMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (isSensitiveSqlLeak(message) || SENSITIVE_KEY.test(message)) {
    return "Details withheld";
  }
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

export function scrubLogMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      if (typeof value === "string") {
        if (isSensitiveSqlLeak(value) || SENSITIVE_KEY.test(value)) continue;
        out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
      } else {
        out[key] = value;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createCorrelationId(): string {
  return createIncidentId("req");
}

export function logOpsEvent(
  input: Omit<StructuredLogEvent, "timestamp"> & { timestamp?: string },
): StructuredLogEvent {
  const event: StructuredLogEvent = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    severity: input.severity,
    correlationId: input.correlationId,
    action: input.action,
    module: input.module,
    outcome: input.outcome,
    actorId: input.actorId,
    schoolId: input.schoolId,
    resourceId: input.resourceId,
    durationMs: input.durationMs,
    errorCategory: input.errorCategory,
    message: scrubLogMessage(input.message),
    meta: scrubLogMeta(input.meta as Record<string, unknown> | undefined),
  };

  const line = JSON.stringify(event);
  if (event.severity === "error") {
    console.error(line);
  } else if (event.severity === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
  return event;
}

export function assertNoSensitiveLogContent(serialized: string): boolean {
  return !/(service_role|eyJhbGci|"password"\s*:|Bearer\s+[A-Za-z0-9\-._~+/]+=*)/i.test(
    serialized,
  );
}
