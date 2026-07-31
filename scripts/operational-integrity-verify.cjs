#!/usr/bin/env node
/**
 * Operational integrity verifier — read-only.
 *
 * Usage:
 *   node scripts/operational-integrity-verify.cjs --offline
 *   node scripts/operational-integrity-verify.cjs --online
 *
 * Online mode requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and only runs SELECT/count style REST queries. Never mutates data.
 * Output avoids student names and financial amounts.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const online = args.has("--online");

/** @type {{ id: string; severity: "info"|"warn"|"fail"; count?: number; message: string }[]} */
const findings = [];

function add(id, severity, message, count) {
  findings.push({ id, severity, message, count });
}

function offlineStaticChecks() {
  const migDir = path.join(ROOT, "supabase", "migrations");
  const files = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"))
    : [];

  const requiredObjects = [
    "academic_event_audits",
    "finance_event_audits",
    "password_reset_audits",
    "student_report_cards",
    "report_card_events",
    "student_exam_result_snapshots",
    "exam_gradebooks",
    "has_academic_capability",
    "log_academic_event",
    "log_finance_event",
  ];

  const blob = files
    .map((f) => fs.readFileSync(path.join(migDir, f), "utf8"))
    .join("\n");

  for (const name of requiredObjects) {
    if (blob.includes(name)) {
      add(name, "info", `Schema artifact referenced in migrations: ${name}`);
    } else {
      add(name, "fail", `Missing expected schema artifact in migrations: ${name}`);
    }
  }

  // Classification helpers for known integrity classes (static documentation of checks).
  const checkClasses = [
    "orphaned_enrolments",
    "duplicate_active_enrolments",
    "invalid_current_academic_year",
    "duplicate_fee_schedules",
    "orphaned_payments",
    "invalid_payment_reversal_relationships",
    "orphaned_gradebooks",
    "duplicate_gradebook_identities",
    "result_snapshot_consistency",
    "stale_report_card_references",
    "approved_published_missing_checksums",
    "cross_school_fk_inconsistencies",
    "capability_role_drift",
    "missing_school_settings",
    "invalid_archived_state_relationships",
  ];
  for (const c of checkClasses) {
    add(
      `class:${c}`,
      "info",
      `Integrity class registered for online/manual review: ${c}`,
    );
  }

  if (!fs.existsSync(path.join(ROOT, "scripts", "production-preflight.cjs"))) {
    add("preflight", "warn", "production-preflight.cjs not found");
  } else {
    add("preflight", "info", "production-preflight.cjs present");
  }
}

async function onlineChecks() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    add(
      "online-env",
      "fail",
      "Online mode requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    return;
  }

  async function restCount(table, query = "select=id") {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    if (!res.ok) {
      add(table, "warn", `Could not count ${table} (HTTP ${res.status})`);
      return null;
    }
    const range = res.headers.get("content-range");
    const match = range && /\/(\d+|\*)/.exec(range);
    const count = match && match[1] !== "*" ? Number(match[1]) : null;
    add(table, "info", `Readable table probe: ${table}`, count ?? undefined);
    return count;
  }

  await restCount("schools");
  await restCount("students");
  await restCount("student_class_enrollments");
  await restCount("payments");
  await restCount("exam_gradebooks");
  await restCount("student_exam_result_snapshots");
  await restCount("student_report_cards");
  await restCount("academic_event_audits");
  await restCount("finance_event_audits");

  // Duplicate active enrolment heuristic via RPC-free limited select is expensive;
  // document as manual/SQL follow-up rather than inventing unsafe filters.
  add(
    "duplicate_active_enrolments",
    "info",
    "Online duplicate-enrolment deep scan deferred to SQL drill (see PHASE_2G_BACKUP_AND_RESTORE.md)",
  );
  add(
    "approved_published_missing_checksums",
    "info",
    "Checksum gaps should be verified with: select count(*) from student_report_cards where status in ('APPROVED','PUBLISHED') and (checksum is null or btrim(checksum)='')",
  );
}

async function main() {
  console.log("=== BFA operational integrity verify ===");
  console.log(`mode=${online ? "online" : "offline"}`);
  console.log("Read-only. No data modifications.\n");

  offlineStaticChecks();
  if (online) {
    await onlineChecks();
  } else {
    add("mode", "info", "Online probes skipped (--offline)");
  }

  let fails = 0;
  let warns = 0;
  for (const f of findings) {
    const countPart = typeof f.count === "number" ? ` count=${f.count}` : "";
    console.log(`[${f.severity.toUpperCase()}] ${f.id}${countPart} — ${f.message}`);
    if (f.severity === "fail") fails += 1;
    if (f.severity === "warn") warns += 1;
  }

  console.log(`\nSummary: fail=${fails} warn=${warns}`);
  if (fails > 0) {
    process.exitCode = 1;
    console.log("INTEGRITY VERIFY FAILED");
  } else {
    console.log("INTEGRITY VERIFY PASSED");
  }
}

main().catch((err) => {
  console.error("Unexpected verifier failure:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
