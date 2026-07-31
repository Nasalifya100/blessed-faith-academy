#!/usr/bin/env node
/**
 * Phase 2G static ops verifier — offline only.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const required = [
  "src/app/api/health/route.ts",
  "src/app/dashboard/settings/system-health/page.tsx",
  "src/app/dashboard/settings/audit-log/page.tsx",
  "src/lib/ops/errors.ts",
  "src/lib/ops/logger.ts",
  "src/lib/ops/deployment-metadata.ts",
  "src/lib/ops/rate-limit.ts",
  "src/lib/ops/pagination.ts",
  "src/lib/ops/upload-policy.ts",
  "scripts/production-preflight.cjs",
  "scripts/operational-integrity-verify.cjs",
  "scripts/write-build-info.cjs",
  "src/lib/ops/build-info.generated.ts",
  "docs/PHASE_2G_OPERATIONAL_HARDENING_PLAN.md",
  "docs/PHASE_2G_SECURITY_REVIEW.md",
  "docs/PHASE_2G_BACKUP_AND_RESTORE.md",
  "docs/PHASE_2G_INCIDENT_RESPONSE.md",
  "docs/PHASE_2G_PRODUCTION_READINESS.md",
];

let fail = 0;
for (const rel of required) {
  const ok = fs.existsSync(path.join(ROOT, rel));
  console.log(`${ok ? "OK" : "MISSING"} ${rel}`);
  if (!ok) fail += 1;
}

const middleware = fs.readFileSync(
  path.join(ROOT, "src/lib/supabase/middleware.ts"),
  "utf8",
);
if (!middleware.includes("/api/health")) {
  console.log("MISSING public /api/health in middleware PUBLIC_PATHS");
  fail += 1;
} else {
  console.log("OK middleware allows /api/health");
}

if (fail > 0) {
  console.log(`PHASE2G VERIFY FAILED (${fail})`);
  process.exitCode = 1;
} else {
  console.log("PHASE2G VERIFY PASSED");
}
