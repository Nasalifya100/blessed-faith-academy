/**
 * Phase 2C Stage 1 — schema / RPC presence probes + optional fixture smoke.
 *
 * Default: read-only structure checks (tables + RPC presence).
 * Optional behavioural matrix: set PHASE2C_SMOKE_FIXTURES to a JSON object
 * with disposable Auth/session fixtures. Without fixtures, smoke is skipped
 * safely (exit 0 after structure probes unless --require-smoke).
 *
 * Usage:
 *   node scripts/phase2c-stage1-verify.cjs
 *   node scripts/phase2c-stage1-verify.cjs --require-smoke
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Never prints secrets. Do not point at production without an explicit ops window.
 *
 * Fixture JSON shape (env PHASE2C_SMOKE_FIXTURES):
 * {
 *   "teacherEmail": "...",
 *   "teacherPassword": "...",
 *   "unassignedTeacherEmail": "...",
 *   "unassignedTeacherPassword": "...",
 *   "elevatedEmail": "...",
 *   "elevatedPassword": "...",
 *   "examId": "uuid",
 *   "classId": "uuid",
 *   "studentIds": ["uuid", ...]   // full eligible roster for submit test
 * }
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

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

  // 1–3: authorised open + idempotency
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

  // 4: valid draft save (partial upsert — one student)
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

  // 5: invalid batch atomic reject
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

  // 6: stale revision
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

  // 7: incomplete submit
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

  // Fill remaining roster then submit
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
      // resubmit then lock
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

  // Direct DML denial as authenticated teacher
  const dml = await teacher.from("exam_gradebooks").update({ revision: 999 }).eq("id", gbId);
  if (!dml.error) fail("direct UPDATE on exam_gradebooks should be denied");
  else ok("direct DML denial");

  // Audit presence (service role)
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

async function main() {
  const requireSmoke = process.argv.includes("--require-smoke");
  const offline = process.argv.includes("--offline");

  if (offline) {
    const migDir = path.join(process.cwd(), "supabase", "migrations");
    const required = [
      "20260724140000_exam_gradebook_enums_and_tables.sql",
      "20260724140100_exam_gradebook_capabilities.sql",
      "20260724140200_exam_gradebook_rpcs.sql",
    ];
    for (const file of required) {
      const full = path.join(migDir, file);
      if (!fs.existsSync(full)) fail(`missing migration ${file}`);
      else ok(`migration present ${file}`);
    }
    const rpcSql = fs.readFileSync(
      path.join(migDir, required[2]),
      "utf8",
    );
    for (const needle of [
      "create or replace function public.open_or_get_exam_gradebook",
      "create or replace function public.get_exam_gradebook",
      "create or replace function public.save_exam_gradebook_draft",
      "create or replace function public.submit_exam_gradebook",
      "p_expected_revision integer",
      "create or replace function public.reopen_exam_gradebook",
      "create or replace function public.lock_exam_gradebook",
    ]) {
      if (!rpcSql.includes(needle)) fail(`RPC migration missing: ${needle}`);
      else ok(`RPC contract text: ${needle}`);
    }
    console.log("");
    console.log("Offline Phase 2C structure checks finished (no database).");
    return;
  }

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env.local — cannot run Stage 1 probes.");
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

  const tables = ["exam_gradebooks", "exam_assessment_results"];
  for (const table of tables) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (error) fail(`table ${table}: ${error.message}`);
    else ok(`table ${table} readable`);
  }

  const rpcNames = [
    "open_or_get_exam_gradebook",
    "get_exam_gradebook",
    "save_exam_gradebook_draft",
    "submit_exam_gradebook",
    "reopen_exam_gradebook",
    "lock_exam_gradebook",
  ];

  for (const name of rpcNames) {
    const { error } = await admin.rpc(name, {});
    if (!error) {
      ok(`rpc ${name} callable`);
      continue;
    }
    const msg = error.message || "";
    if (
      /could not find the function|PGRST202|404/i.test(msg) ||
      /schema cache/i.test(msg)
    ) {
      fail(`rpc ${name} missing: ${msg}`);
    } else {
      ok(`rpc ${name} present (${msg.slice(0, 80)})`);
    }
  }

  for (const name of [
    "teacher_assigned_to_exam_class",
    "exam_gradebook_eligible_student_ids",
    "exam_allows_marks_entry",
    "can_enter_exam_gradebook",
    "assert_exam_class_gradebook_scope",
    "can_read_exam_gradebook",
  ]) {
    const { error } = await admin.rpc(name, {});
    if (error && /could not find the function|PGRST202/i.test(error.message || "")) {
      fail(`helper ${name} missing`);
    } else {
      ok(`helper ${name} exists (internal)`);
    }
  }

  let fixtures = null;
  if (process.env.PHASE2C_SMOKE_FIXTURES) {
    try {
      fixtures = JSON.parse(process.env.PHASE2C_SMOKE_FIXTURES);
    } catch {
      fail("PHASE2C_SMOKE_FIXTURES is not valid JSON");
    }
  }

  console.log("");
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
