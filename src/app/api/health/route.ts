import { NextResponse } from "next/server";

import { getPublicDeploymentSummary } from "@/lib/ops/deployment-metadata";
import { isPublicHealthSafe } from "@/lib/ops/health-status";
import { createCorrelationId, logOpsEvent } from "@/lib/ops/logger";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Public shallow health check.
 * Returns only status, timestamp, version, environment, and short commit.
 */
export async function GET() {
  const correlationId = createCorrelationId();
  const body = getPublicDeploymentSummary();

  if (!isPublicHealthSafe(body)) {
    logOpsEvent({
      severity: "error",
      correlationId,
      action: "public_health",
      module: "ops",
      outcome: "failure",
      errorCategory: "INTERNAL_ERROR",
      message: "Public health payload failed redaction guard",
    });
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        applicationVersion: "redacted",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Correlation-Id": correlationId,
    },
  });
}
