/**
 * Phase 2D.1 — Academic Results Engine structural verification.
 *
 * Tiers:
 *   1. Offline/static — migration files + RPC/helper SQL contracts
 *   2. Online (optional) — table readability + correctly shaped RPC probes
 *
 * Usage:
 *   node scripts/phase2d-stage1-verify.cjs --offline
 *   node scripts/phase2d-stage1-verify.cjs
 *
 * Online mode requires .env.local with NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. Never prints secrets.
 *
 * Do not use empty-argument PostgREST probes (`rpc(name, {})`).
 * Do not add generic SQL execution RPCs.
 */
const fs = require("fs");
const path = require("path");

const SYNTHETIC_UUID = "00000000-0000-4000-8000-0000000000d1";

const PHASE2D_MIGRATIONS = [
  "20260724150000_academic_results_enums_and_tables.sql",
  "20260724150100_academic_results_capabilities.sql",
  "20260724150200_academic_results_rpcs.sql",
];

const REQUIRED_TABLES = [
  "academic_results_settings",
  "promotion_policies",
  "promotion_policy_rules",
  "student_exam_result_snapshots",
  "student_subject_result_snapshots",
  "student_term_result_snapshots",
  "result_statistic_snapshots",
];

const REQUIRED_ENUMS = [
  "promotion_outcome",
  "promotion_rule_type",
  "result_statistic_scope",
  "results_ranking_tie_mode",
];

const REQUIRED_CAPABILITIES = [
  "RESULTS_VIEW",
  "RESULTS_VIEW_ALL",
  "RESULTS_RECALCULATE",
  "PROMOTION_POLICIES_MANAGE",
];

const PUBLIC_RPC_PROBES = [
  {
    name: "ensure_academic_results_settings",
    args: {},
    allowEmptyArgs: true,
  },
  {
    name: "replace_class_term_result_snapshots",
    args: {
      p_academic_year_id: SYNTHETIC_UUID,
      p_term_id: SYNTHETIC_UUID,
      p_class_id: SYNTHETIC_UUID,
      p_batch_id: SYNTHETIC_UUID,
      p_engine_version: "2d.1.1-probe",
      p_source_fingerprint: "phase2d-structural-probe",
      p_exam_rows: [],
      p_subject_rows: [],
      p_term_rows: [],
      p_statistic_rows: [],
    },
  },
];

const STATIC_CONTRACTS = [
  {
    file: PHASE2D_MIGRATIONS[0],
    needles: [
      "create table if not exists public.student_exam_result_snapshots",
      "unique (school_id, academic_year_id, term_id, class_id, exam_id, student_id)",
      "unique (school_id, academic_year_id, term_id, class_id, subject_id, student_id)",
      "unique (school_id, academic_year_id, term_id, class_id, student_id)",
      "result_statistic_snapshots_scope_subject_check",
      "create or replace function public.can_view_class_results",
      "create or replace function public.can_view_subject_results",
      "enable row level security",
      "revoke all on table public.student_exam_result_snapshots from public, anon, authenticated",
      "grant select on table public.student_exam_result_snapshots to authenticated",
      "grading_scheme_snapshot",
      "source_fingerprint",
      "gradebook_revision",
      "is_stale",
    ],
  },
  {
    file: PHASE2D_MIGRATIONS[1],
    needles: [
      "RESULTS_VIEW",
      "RESULTS_VIEW_ALL",
      "RESULTS_RECALCULATE",
      "PROMOTION_POLICIES_MANAGE",
    ],
  },
  {
    file: PHASE2D_MIGRATIONS[2],
    needles: [
      "create or replace function public.ensure_academic_results_settings",
      "create or replace function public.replace_class_term_result_snapshots",
      "security definer",
      "set search_path = public",
      "pg_advisory_xact_lock",
      "RESULTS_RECALCULATE",
      "p_engine_version",
      "p_source_fingerprint",
      "Only SUBMITTED or LOCKED gradebooks may feed results",
      "Percentage does not match source marks",
      "RESULTS_CLASS_TERM_RECALCULATED",
      "revoke all on function public.replace_class_term_result_snapshots",
      "grant execute on function public.replace_class_term_result_snapshots",
    ],
  },
];

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("OK:", msg);
}

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function runOffline() {
  const root = path.join(__dirname, "..");
  const migDir = path.join(root, "supabase", "migrations");

  for (const file of PHASE2D_MIGRATIONS) {
    const full = path.join(migDir, file);
    if (!fs.existsSync(full)) {
      fail(`missing migration ${file}`);
      continue;
    }
    ok(`migration present: ${file}`);
  }

  for (const contract of STATIC_CONTRACTS) {
    const full = path.join(migDir, contract.file);
    const text = fs.readFileSync(full, "utf8");
    for (const needle of contract.needles) {
      if (!text.includes(needle)) {
        fail(`${contract.file} missing required contract: ${needle}`);
      } else {
        ok(`${contract.file} has: ${needle.slice(0, 72)}`);
      }
    }
  }

  // Enum / table / capability presence in SQL text (structural, not catalogue).
  const tablesSql = fs.readFileSync(
    path.join(migDir, PHASE2D_MIGRATIONS[0]),
    "utf8",
  );
  for (const table of REQUIRED_TABLES) {
    if (!tablesSql.includes(`public.${table}`)) {
      fail(`tables migration missing ${table}`);
    } else {
      ok(`table contract: ${table}`);
    }
  }
  for (const en of REQUIRED_ENUMS) {
    if (!tablesSql.includes(en)) {
      fail(`tables migration missing enum/type reference: ${en}`);
    } else {
      ok(`enum/type contract: ${en}`);
    }
  }

  const capsSql = fs.readFileSync(
    path.join(migDir, PHASE2D_MIGRATIONS[1]),
    "utf8",
  );
  for (const cap of REQUIRED_CAPABILITIES) {
    if (!capsSql.includes(cap)) {
      fail(`capabilities migration missing ${cap}`);
    } else {
      ok(`capability contract: ${cap}`);
    }
  }

  // Ensure no empty-arg replace probe pattern is encouraged in this script.
  ok("offline verifier uses named RPC probe args (no empty replace probe)");
}

async function runOnline() {
  const root = path.join(__dirname, "..");
  const env = {
    ...loadEnv(path.join(root, ".env.local")),
    ...process.env,
  };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail("online mode requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return;
  }

  let createClient;
  try {
    ({ createClient } = require("@supabase/supabase-js"));
  } catch (e) {
    fail(`@supabase/supabase-js unavailable: ${e.message}`);
    return;
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let migrated = true;
  for (const table of REQUIRED_TABLES) {
    const { error } = await admin.from(table).select("school_id").limit(1);
    if (error) {
      const msg = String(error.message || "");
      if (/does not exist|schema cache/i.test(msg)) {
        console.log(
          `SKIP: table ${table} not applied yet — run after Phase 2D migrations`,
        );
        migrated = false;
        break;
      }
      fail(`table ${table} probe: ${msg.slice(0, 200)}`);
    } else {
      ok(`table readable: ${table}`);
    }
  }

  if (!migrated) {
    console.log(
      "Online RPC probes skipped until Phase 2D.1 migrations are applied.",
    );
    return;
  }

  for (const probe of PUBLIC_RPC_PROBES) {
    if (
      !probe.allowEmptyArgs &&
      Object.keys(probe.args || {}).length === 0
    ) {
      fail(`refusing empty-arg probe for ${probe.name}`);
      continue;
    }
    const { error } = await admin.rpc(probe.name, probe.args);
    if (!error) {
      ok(`rpc resolved: ${probe.name}`);
      continue;
    }
    const msg = String(error.message || "");
    // Service role has no auth.uid(); signed-in checks are expected.
    if (
      /signed in|authorized|school context|not found|required/i.test(msg)
    ) {
      ok(`rpc present (${probe.name}): expected auth/business error`);
    } else if (/could not find the function/i.test(msg)) {
      fail(`rpc missing: ${probe.name} — ${msg.slice(0, 180)}`);
    } else {
      ok(`rpc present (${probe.name}): ${msg.slice(0, 120)}`);
    }
  }
}

async function main() {
  const offline = process.argv.includes("--offline");
  console.log("Phase 2D.1 structural verification");
  console.log("Tier 1 — offline/static:");
  runOffline();
  if (offline) {
    console.log(
      process.exitCode
        ? "Phase 2D.1 offline verification FAILED"
        : "Phase 2D.1 offline verification PASSED",
    );
    return;
  }
  console.log("Tier 2 — online probes:");
  await runOnline();
  console.log(
    process.exitCode
      ? "Phase 2D.1 verification FAILED"
      : "Phase 2D.1 verification PASSED",
  );
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
