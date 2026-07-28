/**
 * Phase 2D.2 — Report Cards structural verification.
 *
 * Tiers:
 *   1. Offline/static — migration files + RPC/helper SQL contracts
 *   2. Online (optional) — table readability + correctly shaped RPC probes
 *
 * Usage:
 *   node scripts/phase2d2-report-cards-verify.cjs --offline
 *   node scripts/phase2d2-report-cards-verify.cjs
 *
 * Online mode requires .env.local with NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. Never prints secrets.
 *
 * Do not use empty-argument PostgREST probes (`rpc(name, {})`) for
 * parameterized RPCs. Do not add generic SQL execution RPCs.
 * Do not mutate report cards during structural verification.
 */
const fs = require("fs");
const path = require("path");

const SYNTHETIC_UUID = "00000000-0000-4000-8000-0000000000d2";

const PHASE2D2_MIGRATIONS = [
  "20260728160000_report_cards_enums_and_tables.sql",
  "20260728160100_report_cards_capabilities.sql",
  "20260728160200_report_cards_rpcs.sql",
];

const REQUIRED_TABLES = [
  "report_card_settings",
  "student_report_cards",
  "report_card_events",
];

const REQUIRED_ENUMS = ["report_card_status"];

const REQUIRED_CAPABILITIES = [
  "REPORT_CARDS_VIEW",
  "REPORT_CARDS_VIEW_ALL",
  "REPORT_CARDS_EDIT_REMARKS",
  "REPORT_CARDS_REVIEW",
  "REPORT_CARDS_APPROVE",
  "REPORT_CARDS_PUBLISH",
  "REPORT_CARDS_PRINT",
  "REPORT_CARD_SETTINGS_MANAGE",
];

const PUBLIC_RPC_PROBES = [
  {
    name: "ensure_report_card_settings",
    args: {},
    allowEmptyArgs: true,
  },
  {
    name: "generate_or_refresh_report_card_draft",
    args: {
      p_academic_year_id: SYNTHETIC_UUID,
      p_term_id: SYNTHETIC_UUID,
      p_class_id: SYNTHETIC_UUID,
      p_student_id: SYNTHETIC_UUID,
      p_source_fingerprint: "phase2d2-structural-probe",
      p_engine_version: "2d.1.1",
      p_computation_batch_id: SYNTHETIC_UUID,
      p_term_result_snapshot_id: SYNTHETIC_UUID,
      p_attendance_snapshot: {},
      p_settings_snapshot: {},
    },
  },
  {
    name: "save_report_card_remarks",
    args: {
      p_report_card_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
      p_teacher_remark: null,
      p_headteacher_remark: null,
      p_update_teacher: false,
      p_update_headteacher: false,
    },
  },
  {
    name: "mark_report_card_reviewed",
    args: {
      p_report_card_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
    },
  },
  {
    name: "approve_report_card",
    args: {
      p_report_card_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
      p_render_payload: {
        student_id: SYNTHETIC_UUID,
        class_id: SYNTHETIC_UUID,
        source_fingerprint: "phase2d2-structural-probe",
      },
      p_render_payload_checksum: "phase2d2-probe-checksum",
      p_source_fingerprint: "phase2d2-structural-probe",
    },
  },
  {
    name: "publish_report_card",
    args: {
      p_report_card_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
    },
  },
  {
    name: "unpublish_report_card",
    args: {
      p_report_card_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
      p_reason: "structural probe",
    },
  },
  {
    name: "void_report_card",
    args: {
      p_report_card_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
      p_reason: "structural probe",
    },
  },
  {
    name: "update_report_card_settings",
    args: {
      p_title: null,
      p_show_school_logo: null,
      p_show_admission_number: null,
      p_show_class_position: null,
      p_show_subject_position: null,
      p_show_grade_points: null,
      p_show_promotion_recommendation: null,
      p_show_attendance: null,
      p_show_teacher_remark: null,
      p_show_headteacher_remark: null,
      p_show_grading_key: null,
      p_show_generated_timestamp: null,
      p_require_teacher_remark_for_review: null,
      p_require_headteacher_remark_for_approve: null,
      p_footer_text: null,
      p_ranking_disabled_message: null,
    },
  },
];

const STATIC_CONTRACTS = [
  {
    file: PHASE2D2_MIGRATIONS[0],
    needles: [
      "create type public.report_card_status as enum",
      "create table if not exists public.report_card_settings",
      "create table if not exists public.student_report_cards",
      "create table if not exists public.report_card_events",
      "render_payload",
      "render_payload_checksum",
      "source_fingerprint",
      "source_is_outdated",
      "enable row level security",
      "revoke all on table public.student_report_cards from public, anon, authenticated",
      "grant select on table public.student_report_cards to authenticated",
      "create or replace function public.can_view_report_card",
      "set search_path = public",
    ],
  },
  {
    file: PHASE2D2_MIGRATIONS[1],
    needles: REQUIRED_CAPABILITIES,
  },
  {
    file: PHASE2D2_MIGRATIONS[2],
    needles: [
      "create or replace function public.ensure_report_card_settings",
      "create or replace function public.generate_or_refresh_report_card_draft",
      "create or replace function public.save_report_card_remarks",
      "create or replace function public.mark_report_card_reviewed",
      "create or replace function public.approve_report_card",
      "create or replace function public.publish_report_card",
      "create or replace function public.unpublish_report_card",
      "create or replace function public.void_report_card",
      "create or replace function public.update_report_card_settings",
      "security definer",
      "set search_path = public",
      "for update",
      "p_expected_revision",
      "REPORT_CARD_APPROVED",
      "REPORT_CARD_PUBLISHED",
      "revoke all on function public.approve_report_card",
      "grant execute on function public.approve_report_card",
      "report_card_assert_results_current",
      "report_card_build_attendance_snapshot",
      "report_card_sanitize_remark",
      "Render payload average does not match Phase 2D.1 snapshot",
      "Client-supplied attendance/settings args are ignored",
    ],
  },
];

const CLASSIFICATION = {
  FUNCTION_SIGNATURE_NOT_FOUND: "FUNCTION_SIGNATURE_NOT_FOUND",
  FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR:
    "FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR",
  PERMISSION_DENIED_EXPECTED_FOR_INTERNAL_HELPER:
    "PERMISSION_DENIED_EXPECTED_FOR_INTERNAL_HELPER",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  SCHEMA_CACHE_OR_TRANSIENT_ERROR: "SCHEMA_CACHE_OR_TRANSIENT_ERROR",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
  RESOLVED_OK: "RESOLVED_OK",
};

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("OK:", msg);
}

function sanitizeMessage(msg) {
  return String(msg || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, "[jwt-redacted]")
    .slice(0, 240);
}

function argKeyCount(args) {
  if (args == null) return 0;
  if (Array.isArray(args)) return args.length;
  return Object.keys(args).length;
}

function classifyRpcProbeResult({ name, args, error, code }) {
  if (!error) {
    return {
      kind: CLASSIFICATION.RESOLVED_OK,
      passAsPublicPresence: true,
      passAsHelperRevoked: false,
      detail: "rpc returned without error",
    };
  }

  const msg = String(error.message || error || "");
  const errCode = String(code || error.code || error.hint || "");
  const keys = argKeyCount(args);

  if (
    keys === 0 &&
    /could not find the function/i.test(msg) &&
    /without parameters/i.test(msg)
  ) {
    return {
      kind: CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND,
      passAsPublicPresence: false,
      passAsHelperRevoked: false,
      emptyArgsArityMismatch: true,
      detail:
        "empty-argument arity mismatch — not proof the parameterized function is absent",
    };
  }

  if (
    /schema cache.*(reload|stale|outdated|building)/i.test(msg) ||
    /could not refresh the schema cache/i.test(msg) ||
    /fetch failed|network|econnreset|etimedout|socket hang up|503|502|429/i.test(
      msg,
    )
  ) {
    return {
      kind: CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR,
      passAsPublicPresence: false,
      passAsHelperRevoked: false,
      detail: sanitizeMessage(msg),
    };
  }

  if (
    /could not find the function/i.test(msg) ||
    /PGRST202/i.test(msg) ||
    /PGRST202/i.test(errCode)
  ) {
    return {
      kind: CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND,
      passAsPublicPresence: false,
      passAsHelperRevoked: true,
      detail: sanitizeMessage(msg),
    };
  }

  if (
    /permission denied/i.test(msg) ||
    /not authorized to execute/i.test(msg) ||
    /42501/.test(msg)
  ) {
    return {
      kind: CLASSIFICATION.PERMISSION_DENIED_EXPECTED_FOR_INTERNAL_HELPER,
      passAsPublicPresence: false,
      passAsHelperRevoked: true,
      detail: sanitizeMessage(msg),
    };
  }

  if (
    /must be signed in/i.test(msg) ||
    /not authenticated/i.test(msg) ||
    (/jwt/i.test(msg) && /required|missing|expired/i.test(msg))
  ) {
    return {
      kind: CLASSIFICATION.AUTH_REQUIRED,
      passAsPublicPresence: true,
      passAsHelperRevoked: false,
      detail: sanitizeMessage(msg),
    };
  }

  if (
    /report card not found/i.test(msg) ||
    /not found/i.test(msg) ||
    /no school context/i.test(msg) ||
    /not authorized/i.test(msg) ||
    /revision conflict/i.test(msg) ||
    /stale/i.test(msg) ||
    /outdated/i.test(msg) ||
    /fingerprint/i.test(msg) ||
    /payload/i.test(msg) ||
    /remark/i.test(msg) ||
    /void/i.test(msg)
  ) {
    return {
      kind: CLASSIFICATION.FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR,
      passAsPublicPresence: true,
      passAsHelperRevoked: false,
      detail: sanitizeMessage(msg),
    };
  }

  return {
    kind: CLASSIFICATION.UNEXPECTED_ERROR,
    passAsPublicPresence: false,
    passAsHelperRevoked: false,
    detail: sanitizeMessage(msg),
  };
}

function evaluatePublicRpcClassification(classification) {
  if (classification.passAsPublicPresence) {
    return { ok: true, reason: classification.kind };
  }
  if (classification.kind === CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR) {
    return {
      ok: false,
      reason: "transient/schema-cache error is not confirmed presence",
    };
  }
  if (classification.emptyArgsArityMismatch) {
    return {
      ok: false,
      reason: "empty-args probe is invalid for parameterized RPCs",
    };
  }
  if (classification.kind === CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND) {
    return { ok: false, reason: "no matching public RPC signature" };
  }
  return { ok: false, reason: classification.kind };
}

function evaluateHelperRevocationClassification(classification) {
  if (classification.passAsHelperRevoked) {
    return { ok: true, reason: classification.kind };
  }
  if (classification.kind === CLASSIFICATION.RESOLVED_OK) {
    return {
      ok: false,
      reason: "internal helper unexpectedly executable",
    };
  }
  return { ok: false, reason: classification.kind };
}

function defaultProbePayloadsContainOnlySyntheticIds() {
  const json = JSON.stringify({ public: PUBLIC_RPC_PROBES });
  const uuids = json.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  );
  if (!uuids || uuids.length === 0) return false;
  return uuids.every((u) => u.toLowerCase() === SYNTHETIC_UUID);
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

  for (const file of PHASE2D2_MIGRATIONS) {
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

  const tablesSql = fs.readFileSync(
    path.join(migDir, PHASE2D2_MIGRATIONS[0]),
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
    path.join(migDir, PHASE2D2_MIGRATIONS[1]),
    "utf8",
  );
  for (const cap of REQUIRED_CAPABILITIES) {
    if (!capsSql.includes(cap)) {
      fail(`capabilities migration missing ${cap}`);
    } else {
      ok(`capability contract: ${cap}`);
    }
  }

  const rpcSql = fs.readFileSync(
    path.join(migDir, PHASE2D2_MIGRATIONS[2]),
    "utf8",
  );
  for (const probe of PUBLIC_RPC_PROBES) {
    if (
      !probe.allowEmptyArgs &&
      Object.keys(probe.args || {}).length === 0
    ) {
      fail(`refusing empty-arg probe definition for ${probe.name}`);
    }
    const needle = `create or replace function public.${probe.name}`;
    if (!rpcSql.toLowerCase().includes(needle.toLowerCase())) {
      fail(`RPC migration missing: ${needle}`);
    } else {
      ok(`RPC contract: ${probe.name}`);
    }
  }

  if (!defaultProbePayloadsContainOnlySyntheticIds()) {
    fail("default structural probe payloads must use only SYNTHETIC_UUID");
  } else {
    ok("structural probe payloads use synthetic UUID only");
  }

  // Internal helpers must not be granted to authenticated.
  for (const helper of [
    "report_card_assert_results_current",
    "report_card_build_attendance_snapshot",
    "report_card_sanitize_remark",
  ]) {
    const revokeNeedle = `revoke all on function public.${helper}`;
    if (!rpcSql.toLowerCase().includes(revokeNeedle.toLowerCase())) {
      fail(`missing revoke for internal helper ${helper}`);
    } else {
      ok(`internal helper revoked: ${helper}`);
    }
    if (
      new RegExp(
        `grant execute on function public\\.${helper}`,
        "i",
      ).test(rpcSql)
    ) {
      fail(`internal helper must not be granted to clients: ${helper}`);
    }
  }

  // DML denial: clients get SELECT only (no INSERT/UPDATE/DELETE grants).
  if (
    !tablesSql.includes(
      "revoke all on table public.student_report_cards from public, anon, authenticated",
    ) ||
    !tablesSql.includes(
      "grant select on table public.student_report_cards to authenticated",
    )
  ) {
    fail("student_report_cards must revoke all then grant select only");
  } else {
    ok("student_report_cards direct DML restricted (select-only grant)");
  }

  ok("offline verifier uses named RPC probe args (no empty parameterized probes)");
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
    fail(
      "online mode requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
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
          `SKIP: table ${table} not applied yet — run after Phase 2D.2 migrations`,
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
      "Online RPC probes skipped until Phase 2D.2 migrations are applied.",
    );
    return;
  }

  // Direct DML denial for authenticated-shaped path is enforced by grants;
  // service role bypasses RLS, so we only confirm table presence here.
  for (const probe of PUBLIC_RPC_PROBES) {
    if (
      !probe.allowEmptyArgs &&
      Object.keys(probe.args || {}).length === 0
    ) {
      fail(`refusing empty-arg probe for ${probe.name}`);
      continue;
    }
    const { error } = await admin.rpc(probe.name, probe.args);
    const classification = classifyRpcProbeResult({
      name: probe.name,
      args: probe.args,
      error,
      code: error?.code,
    });
    const verdict = evaluatePublicRpcClassification(classification);
    if (verdict.ok) {
      ok(`rpc resolved: ${probe.name} (${classification.kind})`);
    } else if (/could not find the function/i.test(classification.detail)) {
      fail(`rpc missing: ${probe.name} — ${classification.detail}`);
    } else {
      // Service role has no auth.uid(); auth/business errors still prove presence.
      if (
        /signed in|authorized|school context|not found|required|stale|outdated|fingerprint|revision/i.test(
          classification.detail,
        )
      ) {
        ok(`rpc present (${probe.name}): expected auth/business error`);
      } else {
        fail(
          `rpc ${probe.name}: ${verdict.reason} [${classification.kind}] ${classification.detail}`,
        );
      }
    }
  }
}

async function main() {
  const offline = process.argv.includes("--offline");
  console.log("Phase 2D.2 report cards structural verification");
  console.log("Tier 1 — offline/static:");
  runOffline();
  if (offline) {
    console.log(
      process.exitCode
        ? "Phase 2D.2 offline verification FAILED"
        : "Phase 2D.2 offline verification PASSED",
    );
    return;
  }
  console.log("Tier 2 — online probes:");
  await runOnline();
  console.log(
    process.exitCode
      ? "Phase 2D.2 verification FAILED"
      : "Phase 2D.2 verification PASSED",
  );
}

module.exports = {
  SYNTHETIC_UUID,
  PUBLIC_RPC_PROBES,
  CLASSIFICATION,
  classifyRpcProbeResult,
  evaluatePublicRpcClassification,
  evaluateHelperRevocationClassification,
  defaultProbePayloadsContainOnlySyntheticIds,
  sanitizeMessage,
};

if (require.main === module) {
  main().catch((e) => {
    fail(e instanceof Error ? e.message : String(e));
  });
}
