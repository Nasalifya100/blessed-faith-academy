#!/usr/bin/env node
/**
 * Examinations integrity verifier — read-only.
 *
 * Usage:
 *   node scripts/examinations-integrity-verify.cjs --offline
 *   node scripts/examinations-integrity-verify.cjs --online
 *
 * Online mode requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Never mutates data. Output uses counts and safe identifiers only
 * (no student names, admission numbers, or marks).
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

function readMigrationsBlob() {
  const migDir = path.join(ROOT, "supabase", "migrations");
  if (!fs.existsSync(migDir)) return "";
  return fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => fs.readFileSync(path.join(migDir, f), "utf8"))
    .join("\n");
}

function offlineStaticChecks() {
  const requiredFiles = [
    "src/features/examinations/actions.ts",
    "src/features/examinations/queries.ts",
    "src/features/examinations/overview.ts",
    "src/features/examinations/command-centre.ts",
    "src/features/examinations/context-links.ts",
    "src/features/examinations/components/examination-command-centre.tsx",
    "src/features/gradebook/actions.ts",
    "src/features/gradebook/entry-logic.ts",
    "src/features/results/actions.ts",
    "src/features/results/engine/index.ts",
    "src/features/report-cards/actions.ts",
    "src/features/report-cards/snapshot.ts",
    "src/app/dashboard/examinations/page.tsx",
    "src/app/dashboard/gradebook/page.tsx",
    "src/app/dashboard/results/page.tsx",
    "src/app/dashboard/report-cards/page.tsx",
  ];

  for (const rel of requiredFiles) {
    if (fs.existsSync(path.join(ROOT, rel))) {
      add(`file:${rel}`, "info", `Present: ${rel}`);
    } else {
      add(`file:${rel}`, "fail", `Missing required file: ${rel}`);
    }
  }

  const blob = readMigrationsBlob();
  const requiredArtifacts = [
    "exam_periods",
    "exams",
    "exam_schedules",
    "exam_gradebooks",
    "exam_assessment_results",
    "result_entry_status",
    "gradebook_status",
    "student_exam_result_snapshots",
    "student_subject_result_snapshots",
    "student_term_result_snapshots",
    "student_report_cards",
    "assessment_weight_schemes",
    "grading_schemes",
    "replace_class_term_result_snapshots",
    "has_academic_capability",
  ];

  for (const name of requiredArtifacts) {
    if (blob.includes(name)) {
      add(`schema:${name}`, "info", `Migration artifact found: ${name}`);
    } else {
      add(`schema:${name}`, "fail", `Missing migration artifact: ${name}`);
    }
  }

  // Blank vs zero policy must remain explicit in gradebook entry logic.
  const entryLogic = fs.readFileSync(
    path.join(ROOT, "src/features/gradebook/entry-logic.ts"),
    "utf8",
  );
  if (
    entryLogic.includes('kind: "blank"') &&
    entryLogic.includes("SCORED") &&
    entryLogic.includes("ABSENT")
  ) {
    add(
      "blank-vs-zero",
      "info",
      "Gradebook entry-logic distinguishes blank, SCORED (including zero), ABSENT, EXEMPT, NOT_ASSESSED",
    );
  } else {
    add(
      "blank-vs-zero",
      "fail",
      "Gradebook entry-logic missing blank vs scored status separation",
    );
  }

  const overviewPage = fs.readFileSync(
    path.join(ROOT, "src/app/dashboard/examinations/page.tsx"),
    "utf8",
  );
  if (/comes later/i.test(overviewPage)) {
    add(
      "stale-copy",
      "fail",
      "Examinations home still claims marks entry comes later",
    );
  } else {
    add("stale-copy", "info", "Examinations home copy no longer defers marks entry");
  }

  const periodLabels = fs.readFileSync(
    path.join(ROOT, "src/features/examinations/schemas.ts"),
    "utf8",
  );
  if (/CLOSED:\s*"Completed"/.test(periodLabels)) {
    add(
      "closed-label",
      "fail",
      'Period CLOSED must not be labelled "Completed"',
    );
  } else if (/CLOSED:\s*"Closed"/.test(periodLabels)) {
    add("closed-label", "info", 'Period CLOSED labelled "Closed"');
  } else {
    add("closed-label", "warn", "Could not confirm CLOSED period label");
  }

  // Self-check: onlineChecks must not call mutating HTTP/PostgREST verbs.
  const selfSrc = fs.readFileSync(__filename, "utf8");
  const onlineStart = selfSrc.indexOf("async function onlineChecks");
  const onlineFn = onlineStart >= 0 ? selfSrc.slice(onlineStart) : "";
  const mutationHit =
    /\b(method:\s*['"]POST['"]|method:\s*['"]PATCH['"]|method:\s*['"]PUT['"]|method:\s*['"]DELETE['"]|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\/rpc\/)/i.exec(
      onlineFn,
    );
  if (mutationHit) {
    add(
      "online-readonly",
      "fail",
      `Online mode appears to contain a mutation pattern: ${mutationHit[0]}`,
    );
  } else if (!onlineFn.includes("restCount") || !onlineFn.includes("restSelect")) {
    add(
      "online-readonly",
      "fail",
      "Online mode missing expected read-only restCount/restSelect helpers",
    );
  } else {
    add(
      "online-readonly",
      "info",
      "Online mode uses GET-style rest helpers only (no POST/PATCH/PUT/DELETE/RPC)",
    );
  }

  const overviewHelpers = fs.readFileSync(
    path.join(ROOT, "src/features/examinations/overview.ts"),
    "utf8",
  );
  if (
    overviewHelpers.includes("canRecalculateResults") &&
    overviewHelpers.includes("canApproveOrPublishReportCards")
  ) {
    add(
      "role-aware-actions",
      "info",
      "Overview next actions gate Calculate/Approve on capabilities",
    );
  } else {
    add(
      "role-aware-actions",
      "fail",
      "Overview next actions missing capability gates for Calculate/Approve",
    );
  }

  const commandCentre = fs.readFileSync(
    path.join(ROOT, "src/features/examinations/command-centre.ts"),
    "utf8",
  );
  if (
    /PRESENTATION-ONLY|must never be accepted as action input/i.test(
      commandCentre,
    ) &&
    commandCentre.includes("scoreReadiness") &&
    !/recalculateClassTermAction|replace_class_term_result_snapshots|approve_report_card/.test(
      commandCentre,
    )
  ) {
    add(
      "command-centre-presentation",
      "info",
      "Command Centre readiness helpers are presentation-only (no calc/approve authority)",
    );
  } else {
    add(
      "command-centre-presentation",
      "fail",
      "Command Centre appears to embed calculation/approval authority",
    );
  }
  if (
    /first_name|marks_obtained|admission_number|source_fingerprint/.test(
      commandCentre,
    )
  ) {
    add(
      "command-centre-privacy",
      "fail",
      "Command Centre types/helpers reference student names, marks, or fingerprints",
    );
  } else {
    add(
      "command-centre-privacy",
      "info",
      "Command Centre helpers avoid student names, marks, and fingerprints",
    );
  }

  const checkClasses = [
    "examinations_without_valid_year_term",
    "duplicate_examination_identities",
    "assessments_without_examinations",
    "invalid_maximum_marks",
    "invalid_weights",
    "duplicate_assessment_components",
    "teacher_assignments_outside_school",
    "gradebooks_without_valid_exam_class_subject",
    "duplicate_gradebook_identities",
    "marks_above_maximum",
    "negative_marks",
    "ambiguous_blank_zero",
    "submitted_incomplete_required_entries",
    "result_snapshots_missing_sources",
    "stale_result_snapshots",
    "report_cards_without_valid_result_snapshots",
    "approved_published_missing_checksum_payload",
    "cross_school_relationship_violations",
  ];
  for (const c of checkClasses) {
    add(
      `class:${c}`,
      "info",
      `Integrity class registered for online/manual review: ${c}`,
    );
  }
}

async function restCount(url, key, table, query = "select=id") {
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
  return match && match[1] !== "*" ? Number(match[1]) : null;
}

async function restSelect(url, key, table, query) {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    add(table, "warn", `Could not select ${table} (HTTP ${res.status})`);
    return [];
  }
  return res.json();
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

  const tables = [
    "exam_periods",
    "exams",
    "exam_gradebooks",
    "exam_assessment_results",
    "student_term_result_snapshots",
    "student_report_cards",
  ];
  for (const table of tables) {
    const count = await restCount(url, key, table);
    if (count != null) {
      add(`count:${table}`, "info", `Row count for ${table}`, count);
    }
  }

  // Periods missing academic year
  const badPeriods = await restSelect(
    url,
    key,
    "exam_periods",
    "select=id&academic_year_id=is.null&limit=50",
  );
  if (Array.isArray(badPeriods) && badPeriods.length > 0) {
    add(
      "periods-missing-year",
      "fail",
      `Exam periods missing academic_year_id (ids only)`,
      badPeriods.length,
    );
  } else {
    add("periods-missing-year", "info", "No exam periods missing academic_year_id");
  }

  // Invalid max marks on exams
  const badMax = await restSelect(
    url,
    key,
    "exams",
    "select=id&or=(max_marks.lte.0,max_marks.is.null)&limit=50",
  );
  if (Array.isArray(badMax) && badMax.length > 0) {
    add(
      "invalid-max-marks",
      "fail",
      "Exams with non-positive max_marks",
      badMax.length,
    );
  } else {
    add("invalid-max-marks", "info", "No exams with non-positive max_marks detected");
  }

  // Negative marks (ids only)
  const negMarks = await restSelect(
    url,
    key,
    "exam_assessment_results",
    "select=id&marks_obtained=lt.0&limit=50",
  );
  if (Array.isArray(negMarks) && negMarks.length > 0) {
    add(
      "negative-marks",
      "fail",
      "Assessment results with negative marks_obtained",
      negMarks.length,
    );
  } else {
    add("negative-marks", "info", "No negative marks_obtained rows detected");
  }

  // SCORED without marks
  const scoredBlank = await restSelect(
    url,
    key,
    "exam_assessment_results",
    "select=id&entry_status=eq.SCORED&marks_obtained=is.null&limit=50",
  );
  if (Array.isArray(scoredBlank) && scoredBlank.length > 0) {
    add(
      "scored-null-marks",
      "fail",
      "SCORED entries with null marks_obtained",
      scoredBlank.length,
    );
  } else {
    add("scored-null-marks", "info", "No SCORED rows with null marks detected");
  }

  // Stale term snapshots
  const stale = await restCount(
    url,
    key,
    "student_term_result_snapshots",
    "select=id&is_stale=eq.true",
  );
  if (stale != null) {
    add(
      "stale-term-snapshots",
      stale > 0 ? "warn" : "info",
      "Term result snapshots marked stale",
      stale,
    );
  }

  // Approved/published without render payload
  const publishedMissing = await restSelect(
    url,
    key,
    "student_report_cards",
    "select=id&status=in.(APPROVED,PUBLISHED)&render_payload=is.null&limit=50",
  );
  if (Array.isArray(publishedMissing) && publishedMissing.length > 0) {
    add(
      "published-missing-payload",
      "fail",
      "Approved/published report cards missing render_payload",
      publishedMissing.length,
    );
  } else {
    add(
      "published-missing-payload",
      "info",
      "No approved/published report cards missing render_payload",
    );
  }
}

async function main() {
  console.log(
    online
      ? "Examinations integrity verify — ONLINE (read-only)"
      : "Examinations integrity verify — OFFLINE",
  );

  offlineStaticChecks();
  if (online) {
    await onlineChecks();
  }

  let fails = 0;
  let warns = 0;
  for (const f of findings) {
    const countPart = f.count != null ? ` count=${f.count}` : "";
    console.log(`[${f.severity}] ${f.id}: ${f.message}${countPart}`);
    if (f.severity === "fail") fails += 1;
    if (f.severity === "warn") warns += 1;
  }

  console.log(`SUMMARY fails=${fails} warns=${warns} total=${findings.length}`);
  if (fails > 0) {
    console.log("EXAMINATIONS INTEGRITY VERIFY FAILED");
    process.exitCode = 1;
  } else {
    console.log("EXAMINATIONS INTEGRITY VERIFY PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
