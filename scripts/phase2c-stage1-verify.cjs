/**
 * Phase 2C Stage 1 — structural verification + optional fixture smoke.
 *
 * Verification tiers:
 *   1. Offline/static — migration files + RPC/helper SQL contracts
 *   2. Online public RPC resolution — correctly shaped PostgREST probes
 *      with synthetic IDs (no fixtures; no mutations under service role)
 *   3. Optional behavioural smoke — PHASE2C_SMOKE_FIXTURES only
 *
 * Usage:
 *   node scripts/phase2c-stage1-verify.cjs
 *   node scripts/phase2c-stage1-verify.cjs --offline
 *   node scripts/phase2c-stage1-verify.cjs --require-smoke
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (and ANON key for helper privilege probes). Never prints secrets.
 *
 * Catalogue (pg_proc) checks are not used: CI only has the Supabase JS client
 * and there is no approved generic SQL RPC. Public RPCs are probed via
 * PostgREST; internal helpers are verified statically + privilege denial.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

/** Fixed nil UUID for structural probes — never a real production fixture. */
const SYNTHETIC_UUID = "00000000-0000-4000-8000-0000000000c2";

const PHASE2C_MIGRATIONS = [
  "20260724140000_exam_gradebook_enums_and_tables.sql",
  "20260724140100_exam_gradebook_capabilities.sql",
  "20260724140200_exam_gradebook_rpcs.sql",
];

/**
 * Public RPCs granted to authenticated. Probe args match SQL signatures
 * exactly. Service-role calls hit auth.uid() IS NULL before any mutation.
 */
const PUBLIC_RPC_PROBES = [
  {
    name: "open_or_get_exam_gradebook",
    args: { p_exam_id: SYNTHETIC_UUID, p_class_id: SYNTHETIC_UUID },
  },
  {
    name: "get_exam_gradebook",
    args: { p_gradebook_id: SYNTHETIC_UUID },
  },
  {
    name: "save_exam_gradebook_draft",
    args: {
      p_gradebook_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
      p_rows: [],
    },
  },
  {
    name: "submit_exam_gradebook",
    args: {
      p_gradebook_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
    },
  },
  {
    name: "reopen_exam_gradebook",
    args: {
      p_gradebook_id: SYNTHETIC_UUID,
      p_reason: "phase2c-structural-probe",
      p_expected_revision: 1,
    },
  },
  {
    name: "lock_exam_gradebook",
    args: {
      p_gradebook_id: SYNTHETIC_UUID,
      p_expected_revision: 1,
    },
  },
];

/**
 * Internal helpers (not public Gradebook API). Privilege expectations come
 * from the applied migrations — do not treat PostgREST absence as "missing"
 * for revoked helpers.
 */
const INTERNAL_HELPERS = [
  {
    name: "teacher_assigned_to_exam_class",
    args: {
      p_exam_id: SYNTHETIC_UUID,
      p_class_id: SYNTHETIC_UUID,
      p_staff_id: SYNTHETIC_UUID,
    },
    migrationFile: PHASE2C_MIGRATIONS[0],
    createNeedle: "create or replace function public.teacher_assigned_to_exam_class",
    revokeAuthenticated: true,
    staticNeedles: [
      "security definer",
      "set search_path = public",
      "revoke all on function public.teacher_assigned_to_exam_class(uuid, uuid, uuid) from public",
      "revoke all on function public.teacher_assigned_to_exam_class(uuid, uuid, uuid) from anon, authenticated",
    ],
  },
  {
    name: "can_read_exam_gradebook",
    args: { p_gradebook_id: SYNTHETIC_UUID },
    migrationFile: PHASE2C_MIGRATIONS[0],
    createNeedle: "create or replace function public.can_read_exam_gradebook",
    revokeAuthenticated: false,
    staticNeedles: [
      "security definer",
      "set search_path = public",
      "revoke all on function public.can_read_exam_gradebook(uuid) from public",
      "grant execute on function public.can_read_exam_gradebook(uuid) to authenticated",
    ],
  },
  {
    name: "exam_gradebook_eligible_student_ids",
    args: { p_exam_id: SYNTHETIC_UUID, p_class_id: SYNTHETIC_UUID },
    migrationFile: PHASE2C_MIGRATIONS[0],
    createNeedle: "create or replace function public.exam_gradebook_eligible_student_ids",
    revokeAuthenticated: true,
    staticNeedles: [
      "security definer",
      "set search_path = public",
      "revoke all on function public.exam_gradebook_eligible_student_ids(uuid, uuid) from public",
      "revoke all on function public.exam_gradebook_eligible_student_ids(uuid, uuid) from anon, authenticated",
    ],
  },
  {
    name: "exam_allows_marks_entry",
    args: { p_exam_id: SYNTHETIC_UUID },
    migrationFile: PHASE2C_MIGRATIONS[2],
    createNeedle: "create or replace function public.exam_allows_marks_entry",
    revokeAuthenticated: true,
    staticNeedles: [
      "security definer",
      "set search_path = public",
      "revoke all on function public.exam_allows_marks_entry(uuid) from public",
      "revoke all on function public.exam_allows_marks_entry(uuid) from anon, authenticated",
    ],
  },
  {
    name: "can_enter_exam_gradebook",
    args: { p_exam_id: SYNTHETIC_UUID, p_class_id: SYNTHETIC_UUID },
    migrationFile: PHASE2C_MIGRATIONS[2],
    createNeedle: "create or replace function public.can_enter_exam_gradebook",
    revokeAuthenticated: true,
    staticNeedles: [
      "security definer",
      "set search_path = public",
      "revoke all on function public.can_enter_exam_gradebook(uuid, uuid) from public",
      "revoke all on function public.can_enter_exam_gradebook(uuid, uuid) from anon, authenticated",
    ],
  },
  {
    name: "assert_exam_class_gradebook_scope",
    args: { p_exam_id: SYNTHETIC_UUID, p_class_id: SYNTHETIC_UUID },
    migrationFile: PHASE2C_MIGRATIONS[2],
    createNeedle: "create or replace function public.assert_exam_class_gradebook_scope",
    revokeAuthenticated: true,
    staticNeedles: [
      "security definer",
      "set search_path = public",
      "revoke all on function public.assert_exam_class_gradebook_scope(uuid, uuid) from public",
      "revoke all on function public.assert_exam_class_gradebook_scope(uuid, uuid) from anon, authenticated",
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

function loadEnv(file) {
  const env = {};
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

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("OK:", msg);
}

function skip(msg) {
  console.log("SKIP:", msg);
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

/**
 * Classify a PostgREST / Supabase RPC probe outcome.
 * Empty `{}` arity mismatches are NOT proof that every overload is absent.
 */
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
  const lower = msg.toLowerCase();
  const errCode = String(code || error.code || error.hint || "");
  const keys = argKeyCount(args);

  // Empty-object arity mismatch (the Phase 2C deploy false positive).
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

  // Transient / cache reload wording without a definitive missing signature.
  if (
    /schema cache.*(reload|stale|outdated|building)/i.test(msg) ||
    /could not refresh the schema cache/i.test(msg)
  ) {
    return {
      kind: CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR,
      passAsPublicPresence: false,
      passAsHelperRevoked: false,
      detail: sanitizeMessage(msg),
    };
  }

  if (
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

  // True absence / wrong signature for the supplied named arguments.
  if (
    /could not find the function/i.test(msg) ||
    /PGRST202/i.test(msg) ||
    /PGRST202/i.test(errCode) ||
    (/\b404\b/.test(msg) && /function/i.test(msg))
  ) {
    return {
      kind: CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND,
      passAsPublicPresence: false,
      // PostgREST hides non-EXECUTE functions from the role's schema cache.
      passAsHelperRevoked: true,
      detail: sanitizeMessage(msg),
    };
  }

  if (
    /permission denied/i.test(msg) ||
    /not authorized to execute/i.test(msg) ||
    /PGRST301/i.test(msg) ||
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
    (/jwt/i.test(msg) && /required|missing|expired/i.test(msg)) ||
    /PGRST301/i.test(errCode)
  ) {
    return {
      kind: CLASSIFICATION.AUTH_REQUIRED,
      passAsPublicPresence: true,
      passAsHelperRevoked: false,
      detail: sanitizeMessage(msg),
    };
  }

  // Expected business / validation / not-found paths once the function resolved.
  if (
    /gradebook not found/i.test(msg) ||
    /exam not found/i.test(msg) ||
    /class not found/i.test(msg) ||
    /no school context/i.test(msg) ||
    /not authorized/i.test(msg) ||
    /revision conflict/i.test(msg) ||
    /invalid/i.test(msg) ||
    /marks entry is not available/i.test(msg) ||
    /reason/i.test(msg)
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
      reason: "internal helper unexpectedly executable by authenticated",
    };
  }
  if (classification.kind === CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR) {
    return {
      ok: false,
      reason: "transient/schema-cache error is not confirmed revocation",
    };
  }
  return { ok: false, reason: classification.kind };
}

function defaultProbePayloadsContainOnlySyntheticIds() {
  const json = JSON.stringify({
    public: PUBLIC_RPC_PROBES,
    helpers: INTERNAL_HELPERS.map((h) => ({ name: h.name, args: h.args })),
  });
  const uuids = json.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  );
  if (!uuids || uuids.length === 0) return false;
  return uuids.every((u) => u.toLowerCase() === SYNTHETIC_UUID);
}

function runOfflineChecks() {
  const migDir = path.join(process.cwd(), "supabase", "migrations");
  const texts = {};

  for (const file of PHASE2C_MIGRATIONS) {
    const full = path.join(migDir, file);
    if (!fs.existsSync(full)) {
      fail(`missing migration ${file}`);
      continue;
    }
    texts[file] = fs.readFileSync(full, "utf8");
    ok(`migration present ${file}`);
  }

  const rpcSql = texts[PHASE2C_MIGRATIONS[2]] || "";
  for (const probe of PUBLIC_RPC_PROBES) {
    const needle = `create or replace function public.${probe.name}`;
    if (!rpcSql.toLowerCase().includes(needle.toLowerCase())) {
      fail(`RPC migration missing: ${needle}`);
    } else {
      ok(`RPC contract text: ${needle}`);
    }
  }
  if (!/p_expected_revision\s+integer/i.test(rpcSql)) {
    fail("RPC migration missing: p_expected_revision integer");
  } else {
    ok("RPC contract text: p_expected_revision integer");
  }

  console.log("");
  console.log("Helper static definitions + privilege contracts:");
  for (const helper of INTERNAL_HELPERS) {
    const sql = texts[helper.migrationFile] || "";
    if (!sql.toLowerCase().includes(helper.createNeedle.toLowerCase())) {
      fail(`helper definition missing: ${helper.createNeedle}`);
      continue;
    }
    let helperOk = true;
    for (const needle of helper.staticNeedles) {
      if (!sql.toLowerCase().includes(needle.toLowerCase())) {
        fail(`helper ${helper.name} missing contract: ${needle}`);
        helperOk = false;
      }
    }
    if (helperOk) {
      ok(
        `helper ${helper.name} static (${
          helper.revokeAuthenticated
            ? "EXECUTE revoked from authenticated"
            : "EXECUTE granted to authenticated"
        })`,
      );
    }
  }

  if (!defaultProbePayloadsContainOnlySyntheticIds()) {
    fail("default structural probe payloads must use only SYNTHETIC_UUID");
  } else {
    ok("structural probe payloads use synthetic UUID only");
  }

  console.log("");
  console.log("Offline Phase 2C structure checks finished (no database).");
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign-in failed for fixture user (${error?.message || "no session"})`);
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function runSmoke(admin, env, fixtures) {
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) {
    fail("smoke requires NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return;
  }

  const required = [
    "teacherEmail",
    "teacherPassword",
    "examId",
    "classId",
    "studentIds",
  ];
  for (const k of required) {
    if (fixtures[k] == null || fixtures[k] === "") {
      fail(`smoke fixture missing ${k}`);
      return;
    }
  }
  if (!Array.isArray(fixtures.studentIds) || fixtures.studentIds.length < 1) {
    fail("smoke fixture studentIds must be a non-empty array");
    return;
  }

  const teacher = await signIn(
    env.NEXT_PUBLIC_SUPABASE_URL,
    anon,
    fixtures.teacherEmail,
    fixtures.teacherPassword,
  );

  const open1 = await teacher.rpc("open_or_get_exam_gradebook", {
    p_exam_id: fixtures.examId,
    p_class_id: fixtures.classId,
  });
  if (open1.error) {
    fail(`teacher open: ${open1.error.message}`);
    return;
  }
  ok("teacher authorised open");
  const gbId = open1.data?.gradebook?.id;
  let revision = open1.data?.gradebook?.revision;
  if (!gbId || revision == null) {
    fail("open response missing gradebook id/revision");
    return;
  }

  const open2 = await teacher.rpc("open_or_get_exam_gradebook", {
    p_exam_id: fixtures.examId,
    p_class_id: fixtures.classId,
  });
  if (open2.error || open2.data?.gradebook?.id !== gbId) {
    fail(`duplicate open idempotency: ${open2.error?.message || "id mismatch"}`);
    return;
  }
  ok("duplicate open idempotency");

  if (fixtures.unassignedTeacherEmail && fixtures.unassignedTeacherPassword) {
    const other = await signIn(
      env.NEXT_PUBLIC_SUPABASE_URL,
      anon,
      fixtures.unassignedTeacherEmail,
      fixtures.unassignedTeacherPassword,
    );
    const denied = await other.rpc("open_or_get_exam_gradebook", {
      p_exam_id: fixtures.examId,
      p_class_id: fixtures.classId,
    });
    if (!denied.error) fail("unassigned teacher should be rejected");
    else ok("unassigned teacher rejection");
  } else {
    skip("unassigned teacher (fixture absent)");
  }

  const firstStudent = fixtures.studentIds[0];
  const saveOk = await teacher.rpc("save_exam_gradebook_draft", {
    p_gradebook_id: gbId,
    p_expected_revision: revision,
    p_rows: [
      {
        student_id: firstStudent,
        entry_status: "SCORED",
        marks_obtained: 1,
      },
    ],
  });
  if (saveOk.error) {
    fail(`valid draft save: ${saveOk.error.message}`);
    return;
  }
  revision = saveOk.data?.revision;
  ok("valid draft save (partial upsert)");

  const bad = await teacher.rpc("save_exam_gradebook_draft", {
    p_gradebook_id: gbId,
    p_expected_revision: revision,
    p_rows: [
      {
        student_id: firstStudent,
        entry_status: "SCORED",
        marks_obtained: -1,
      },
    ],
  });
  if (!bad.error) fail("negative marks should be rejected");
  else ok("atomic invalid batch rejection");

  const stale = await teacher.rpc("save_exam_gradebook_draft", {
    p_gradebook_id: gbId,
    p_expected_revision: revision - 1,
    p_rows: [
      {
        student_id: firstStudent,
        entry_status: "ABSENT",
      },
    ],
  });
  if (!stale.error || !/revision conflict/i.test(stale.error.message || "")) {
    fail(`stale revision expected conflict, got: ${stale.error?.message || "success"}`);
  } else {
    ok("stale revision conflict");
  }

  const incomplete = await teacher.rpc("submit_exam_gradebook", {
    p_gradebook_id: gbId,
    p_expected_revision: revision,
  });
  if (fixtures.studentIds.length > 1) {
    if (!incomplete.error) fail("incomplete submit should be blocked");
    else ok("incomplete submission rejection");
  } else {
    skip("incomplete submit (single-student roster)");
  }

  const rows = fixtures.studentIds.map((id, i) =>
    i === 0
      ? { student_id: id, entry_status: "SCORED", marks_obtained: 1 }
      : { student_id: id, entry_status: "ABSENT" },
  );
  const saveAll = await teacher.rpc("save_exam_gradebook_draft", {
    p_gradebook_id: gbId,
    p_expected_revision: revision,
    p_rows: rows,
  });
  if (saveAll.error) {
    fail(`full draft save: ${saveAll.error.message}`);
    return;
  }
  revision = saveAll.data.revision;

  const submit = await teacher.rpc("submit_exam_gradebook", {
    p_gradebook_id: gbId,
    p_expected_revision: revision,
  });
  if (submit.error) {
    fail(`complete submit: ${submit.error.message}`);
    return;
  }
  revision = submit.data.revision;
  ok("successful complete submission");

  const editAfter = await teacher.rpc("save_exam_gradebook_draft", {
    p_gradebook_id: gbId,
    p_expected_revision: revision,
    p_rows: rows.slice(0, 1),
  });
  if (!editAfter.error) fail("submitted edit should be rejected");
  else ok("submitted edit rejection");

  if (fixtures.elevatedEmail && fixtures.elevatedPassword) {
    const elevated = await signIn(
      env.NEXT_PUBLIC_SUPABASE_URL,
      anon,
      fixtures.elevatedEmail,
      fixtures.elevatedPassword,
    );
    const blank = await elevated.rpc("reopen_exam_gradebook", {
      p_gradebook_id: gbId,
      p_reason: "   ",
      p_expected_revision: revision,
    });
    if (!blank.error) fail("blank reopen reason should be rejected");
    else ok("blank reason rejection");

    const reopen = await elevated.rpc("reopen_exam_gradebook", {
      p_gradebook_id: gbId,
      p_reason: "Stage 1 smoke reopen",
      p_expected_revision: revision,
    });
    if (reopen.error) fail(`authorised reopen: ${reopen.error.message}`);
    else {
      ok("authorised reopen");
      revision = reopen.data.revision;
      const resave = await elevated.rpc("save_exam_gradebook_draft", {
        p_gradebook_id: gbId,
        p_expected_revision: revision,
        p_rows: rows,
      });
      if (resave.error) {
        fail(`reopen draft save: ${resave.error.message}`);
      } else {
        revision = resave.data.revision;
        const resubmit = await elevated.rpc("submit_exam_gradebook", {
          p_gradebook_id: gbId,
          p_expected_revision: revision,
        });
        if (resubmit.error) fail(`resubmit: ${resubmit.error.message}`);
        else {
          revision = resubmit.data.revision;
          const lock = await elevated.rpc("lock_exam_gradebook", {
            p_gradebook_id: gbId,
            p_expected_revision: revision,
          });
          if (lock.error) fail(`lock: ${lock.error.message}`);
          else ok("lock behavior");

          const reopenLocked = await elevated.rpc("reopen_exam_gradebook", {
            p_gradebook_id: gbId,
            p_reason: "should fail on locked",
            p_expected_revision: revision + 1,
          });
          if (!reopenLocked.error) fail("LOCKED reopen should be rejected");
          else ok("LOCKED cannot reopen");
        }
      }
    }
  } else {
    skip("reopen/lock (elevated fixture absent)");
  }

  const dml = await teacher.from("exam_gradebooks").update({ revision: 999 }).eq("id", gbId);
  if (!dml.error) fail("direct UPDATE on exam_gradebooks should be denied");
  else ok("direct DML denial");

  const { data: audits, error: auditErr } = await admin
    .from("academic_event_audits")
    .select("event_type")
    .eq("entity_id", gbId)
    .in("event_type", [
      "GRADEBOOK_OPENED",
      "GRADEBOOK_DRAFT_SAVED",
      "GRADEBOOK_SUBMITTED",
      "GRADEBOOK_REOPENED",
      "GRADEBOOK_LOCKED",
    ]);
  if (auditErr) fail(`audit query: ${auditErr.message}`);
  else if (!audits || audits.length < 2) fail("expected audit events for gradebook");
  else ok(`audit creation (${audits.length} matching events)`);

  ok("smoke matrix finished");
}

async function runOnlineStructural(admin, env) {
  console.log("Tier 2 — online tables + public RPC resolution:");
  const tables = ["exam_gradebooks", "exam_assessment_results"];
  for (const table of tables) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (error) fail(`table ${table}: ${sanitizeMessage(error.message)}`);
    else ok(`table ${table} readable`);
  }

  for (const probe of PUBLIC_RPC_PROBES) {
    const { error, data } = await admin.rpc(probe.name, probe.args);
    const classification = classifyRpcProbeResult({
      name: probe.name,
      args: probe.args,
      error,
      code: error?.code,
    });
    const verdict = evaluatePublicRpcClassification(classification);
    if (verdict.ok) {
      ok(
        `rpc ${probe.name} resolved (${classification.kind}${
          data != null ? ", data returned" : ""
        }: ${classification.detail})`,
      );
    } else {
      fail(
        `rpc ${probe.name}: ${verdict.reason} [${classification.kind}] ${classification.detail}`,
      );
    }
  }

  console.log("");
  console.log(
    "Helper privilege probes (authenticated / anon — not service-role presence):",
  );
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    fail("NEXT_PUBLIC_SUPABASE_ANON_KEY required for helper privilege probes");
    return;
  }

  const anonClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const helper of INTERNAL_HELPERS) {
    if (!helper.revokeAuthenticated) {
      // can_read is granted to authenticated; resolve via correctly shaped probe.
      const { error } = await anonClient.rpc(helper.name, helper.args);
      const classification = classifyRpcProbeResult({
        name: helper.name,
        args: helper.args,
        error,
        code: error?.code,
      });
      // Anon without JWT may see auth/school errors or still resolve boolean false.
      if (
        classification.passAsPublicPresence ||
        classification.kind === CLASSIFICATION.RESOLVED_OK ||
        classification.kind ===
          CLASSIFICATION.FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR ||
        classification.kind === CLASSIFICATION.AUTH_REQUIRED
      ) {
        ok(
          `helper ${helper.name} granted path resolved (${classification.kind})`,
        );
      } else if (
        classification.kind === CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND
      ) {
        // Anon may lack EXECUTE even when authenticated has it — static grant
        // was already checked offline; do not fail the deploy gate solely here.
        ok(
          `helper ${helper.name} not exposed to anon (grant is to authenticated; static grant verified offline)`,
        );
      } else if (
        classification.kind === CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR
      ) {
        fail(
          `helper ${helper.name}: transient error is not confirmed presence [${classification.detail}]`,
        );
      } else {
        fail(
          `helper ${helper.name}: unexpected [${classification.kind}] ${classification.detail}`,
        );
      }
      continue;
    }

    const { error } = await anonClient.rpc(helper.name, helper.args);
    const classification = classifyRpcProbeResult({
      name: helper.name,
      args: helper.args,
      error,
      code: error?.code,
    });
    const verdict = evaluateHelperRevocationClassification(classification);
    if (verdict.ok) {
      ok(
        `helper ${helper.name} not executable by anon/authenticated API (${classification.kind})`,
      );
    } else if (
      classification.kind === CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR
    ) {
      fail(
        `helper ${helper.name}: transient error is not confirmed revocation [${classification.detail}]`,
      );
    } else {
      fail(
        `helper ${helper.name}: ${verdict.reason} [${classification.kind}] ${classification.detail}`,
      );
    }
  }
}

async function main() {
  const requireSmoke = process.argv.includes("--require-smoke");
  const offline = process.argv.includes("--offline");

  console.log("Tier 1 — offline/static structure:");
  runOfflineChecks();
  if (offline) {
    return;
  }

  console.log("");
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env.local — cannot run Stage 1 online probes.");
    process.exit(1);
  }
  const env = loadEnv(envPath);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase URL or service role key in .env.local.");
    process.exit(1);
  }

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  await runOnlineStructural(admin, env);

  let fixtures = null;
  if (process.env.PHASE2C_SMOKE_FIXTURES) {
    try {
      fixtures = JSON.parse(process.env.PHASE2C_SMOKE_FIXTURES);
    } catch {
      fail("PHASE2C_SMOKE_FIXTURES is not valid JSON");
    }
  }

  console.log("");
  console.log("Tier 3 — optional behavioural smoke:");
  if (fixtures && process.exitCode !== 1) {
    console.log("Running optional smoke matrix with fixtures…");
    await runSmoke(admin, env, fixtures);
  } else if (requireSmoke) {
    fail(
      "PHASE2C_SMOKE_FIXTURES required (--require-smoke) but missing or invalid",
    );
  } else {
    skip(
      "behavioural smoke (set PHASE2C_SMOKE_FIXTURES for open/save/submit/reopen/lock matrix)",
    );
  }

  console.log("");
  console.log(
    "Stage 1 probes finished. See docs/PHASE_2C_STAGE_1_VERIFICATION.md.",
  );
}

module.exports = {
  SYNTHETIC_UUID,
  PUBLIC_RPC_PROBES,
  INTERNAL_HELPERS,
  CLASSIFICATION,
  classifyRpcProbeResult,
  evaluatePublicRpcClassification,
  evaluateHelperRevocationClassification,
  defaultProbePayloadsContainOnlySyntheticIds,
  sanitizeMessage,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
