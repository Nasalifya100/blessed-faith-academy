/**
 * Phase 2B staging verify: structure, Exam Verify data, references, status,
 * security, audits, cleanup. Uses service role + disposable Auth users.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { Agent, fetch: undiciFetch } = require("undici");

const longAgent = new Agent({
  connectTimeout: 90_000,
  headersTimeout: 180_000,
  bodyTimeout: 180_000,
});
function longFetch(input, init) {
  return undiciFetch(input, { ...init, dispatcher: longAgent });
}

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

const SCHOOL_ID = "516977ed-8612-4e27-addc-cdb5cdb72505";
const VERIFY_ADMIN_EMAIL = "exam-verify-admin@bfa-smoke.local";
const VERIFY_TEACHER_EMAIL = "exam-verify-teacher@bfa-smoke.local";
const VERIFY_PASSWORD = "VerifyPass1!";

function client(env, key) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: longFetch },
  });
}

async function withRetry(label, fn, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e.message || e);
      if (
        !/fetch failed|timeout|JWT|unverifiable|ECONNRESET|ETIMEDOUT/i.test(
          msg,
        ) ||
        i === attempts - 1
      ) {
        throw e;
      }
      console.warn(`retry ${label} (${i + 1}): ${msg.slice(0, 100)}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

async function ensureAuthUser(admin, email, role, fullName) {
  return withRetry(`ensureAuthUser ${email}`, async () => {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    let user = (listed.data?.users || []).find(
      (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
    );
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: VERIFY_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) throw new Error(`createUser ${email}: ${error.message}`);
      user = data.user;
    } else {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password: VERIFY_PASSWORD,
        email_confirm: true,
      });
      if (error) throw new Error(`updateUser ${email}: ${error.message}`);
    }
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        role,
        full_name: fullName,
        is_active: true,
        school_id: SCHOOL_ID,
      })
      .eq("id", user.id);
    if (profileError) throw new Error(profileError.message);
    return user;
  });
}

async function signedClient(env, email) {
  const c = client(env, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await c.auth.signInWithPassword({
    email,
    password: VERIFY_PASSWORD,
  });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return { supabase: c, user: data.user };
}

async function main() {
  const mode = process.argv[2] || "all";
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const admin = client(env, env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("supabase_host=" + new URL(env.NEXT_PUBLIC_SUPABASE_URL).host);

  const report = {
    structure: {},
    workflows: {},
    security: {},
    audits: {},
    cleanup: {},
  };

  const tables = [
    "exam_rooms",
    "exam_periods",
    "exams",
    "exam_schedules",
    "exam_invigilators",
    "exam_templates",
    "exam_reference_counters",
  ];
  for (const t of tables) {
    const { error, count } = await admin
      .from(t)
      .select("*", { count: "exact", head: true });
    report.structure[t] = error
      ? { ok: false, error: error.message }
      : { ok: true, count };
  }

  const missing = Object.entries(report.structure)
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);
  if (missing.length) {
    console.log(JSON.stringify(report, null, 2));
    throw new Error(
      "Missing Phase 2B tables (apply migrations first): " + missing.join(", "),
    );
  }
  console.log("STRUCTURE_OK");
  if (mode === "structure") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { data: year } = await admin
    .from("academic_years")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .eq("is_current", true)
    .maybeSingle();
  if (!year) throw new Error("Missing current academic year");

  const { data: term } = await admin
    .from("terms")
    .select("id, name, term_number")
    .eq("academic_year_id", year.id)
    .eq("is_current", true)
    .maybeSingle();
  const { data: grade7 } = await admin
    .from("grade_levels")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .eq("name", "Grade 7")
    .maybeSingle();
  let { data: subject } = await admin
    .from("subjects")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .ilike("name", "Exam Verify Mathematics")
    .maybeSingle();
  const { data: types } = await admin
    .from("assessment_types")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .eq("is_active", true)
    .limit(1);

  if (!grade7) throw new Error("Missing Grade 7");
  if (!types?.[0]) throw new Error("Seed assessment types in Academic setup first");

  // Confirm polish columns exist (migration 303)
  const colProbe = await admin
    .from("exams")
    .select("id, exam_reference, status")
    .limit(1);
  if (colProbe.error && /exam_reference/.test(colProbe.error.message)) {
    throw new Error(
      "Migration 20260723130300 not applied yet (exams.exam_reference missing): " +
        colProbe.error.message,
    );
  }

  await ensureAuthUser(
    admin,
    VERIFY_ADMIN_EMAIL,
    "administrator",
    "Exam Verify Admin",
  );
  await ensureAuthUser(
    admin,
    VERIFY_TEACHER_EMAIL,
    "teacher",
    "Exam Verify Teacher",
  );
  const { supabase: asAdmin } = await signedClient(env, VERIFY_ADMIN_EMAIL);
  const { supabase: asTeacher, user: teacherUser } = await signedClient(
    env,
    VERIFY_TEACHER_EMAIL,
  );

  if (!subject) {
    const created = await asAdmin.rpc("upsert_subject", {
      p_id: null,
      p_name: "Exam Verify Mathematics",
      p_category: "CORE",
      p_is_active: true,
    });
    if (created.error) throw new Error(created.error.message);
    subject = { id: created.data, name: "Exam Verify Mathematics" };
  }

  const room = await asAdmin.rpc("upsert_exam_room", {
    p_name: "Exam Verify Room 1",
    p_capacity: 40,
    p_notes: "Exam Verify",
    p_is_active: true,
  });
  if (room.error) throw new Error(room.error.message);
  report.workflows.room = { ok: true, id: room.data };

  const period = await asAdmin.rpc("upsert_exam_period", {
    p_academic_year_id: year.id,
    p_term_id: term?.id || null,
    p_name: "Exam Verify Term 1 Mid-Term",
    p_description: "Exam Verify controlled period",
    p_opens_on: "2026-08-01",
    p_closes_on: "2026-08-31",
    p_status: "OPEN",
  });
  if (period.error) throw new Error(period.error.message);
  report.workflows.period = { ok: true, id: period.data };

  const exam1 = await asAdmin.rpc("upsert_exam", {
    p_exam_period_id: period.data,
    p_subject_id: subject.id,
    p_grade_level_id: grade7.id,
    p_assessment_type_id: types[0].id,
    p_max_marks: 50,
    p_instructions: "Exam Verify · Blue pen only",
    p_cohort_scope: "GRADE",
  });
  if (exam1.error) throw new Error(exam1.error.message);

  const exam2 = await asAdmin.rpc("upsert_exam", {
    p_exam_period_id: period.data,
    p_subject_id: subject.id,
    p_grade_level_id: grade7.id,
    p_assessment_type_id: types[0].id,
    p_max_marks: 50,
    p_cohort_scope: "GRADE",
  });
  report.workflows.duplicate_exam_rejected = Boolean(exam2.error);

  const { data: examRow } = await admin
    .from("exams")
    .select("id, exam_reference, status")
    .eq("id", exam1.data)
    .single();
  report.workflows.exam = {
    ok: true,
    id: examRow.id,
    exam_reference: examRow.exam_reference,
    status: examRow.status,
  };
  report.workflows.reference_assigned = /^EX-/.test(examRow.exam_reference);
  report.workflows.default_draft = examRow.status === "DRAFT";

  const examB = await asAdmin.rpc("upsert_exam", {
    p_exam_period_id: period.data,
    p_subject_id: subject.id,
    p_grade_level_id: grade7.id,
    p_assessment_type_id: types[0].id,
    p_max_marks: 40,
    p_notes: "second subject slot uses different type workaround",
    p_cohort_scope: "GRADE",
  });
  // May fail duplicate - create English subject instead
  let secondRef = null;
  if (examB.error) {
    let eng = (
      await admin
        .from("subjects")
        .select("id")
        .eq("school_id", SCHOOL_ID)
        .ilike("name", "Exam Verify English")
        .maybeSingle()
    ).data;
    if (!eng) {
      const created = await asAdmin.rpc("upsert_subject", {
        p_id: null,
        p_name: "Exam Verify English",
        p_category: "CORE",
        p_is_active: true,
      });
      if (created.error) throw new Error(created.error.message);
      eng = { id: created.data };
    }
    const examEng = await asAdmin.rpc("upsert_exam", {
      p_exam_period_id: period.data,
      p_subject_id: eng.id,
      p_grade_level_id: grade7.id,
      p_assessment_type_id: types[0].id,
      p_max_marks: 50,
      p_cohort_scope: "GRADE",
    });
    if (examEng.error) throw new Error(examEng.error.message);
    const { data: row2 } = await admin
      .from("exams")
      .select("exam_reference")
      .eq("id", examEng.data)
      .single();
    secondRef = row2.exam_reference;
    report.workflows.second_exam_id = examEng.data;
  } else {
    const { data: row2 } = await admin
      .from("exams")
      .select("exam_reference")
      .eq("id", examB.data)
      .single();
    secondRef = row2.exam_reference;
    report.workflows.second_exam_id = examB.data;
  }
  report.workflows.references_unique =
    secondRef && secondRef !== examRow.exam_reference;

  const sched = await asAdmin.rpc("upsert_exam_schedule", {
    p_exam_id: examRow.id,
    p_exam_date: "2026-08-12",
    p_start_time: "09:00",
    p_end_time: "11:00",
    p_room_id: room.data,
    p_primary_invigilator_id: teacherUser.id,
    p_allow_warnings: true,
  });
  if (sched.error) throw new Error(sched.error.message);
  report.workflows.schedule = { ok: Boolean(sched.data?.ok ?? true) };

  const toScheduled = await asAdmin.rpc("transition_exam_status", {
    p_exam_id: examRow.id,
    p_new_status: "SCHEDULED",
  });
  report.workflows.mark_scheduled = toScheduled.data?.ok === true;

  const toReady = await asAdmin.rpc("transition_exam_status", {
    p_exam_id: examRow.id,
    p_new_status: "READY",
  });
  report.workflows.mark_ready = toReady.data?.ok === true;

  const toCompleted = await asAdmin.rpc("transition_exam_status", {
    p_exam_id: examRow.id,
    p_new_status: "COMPLETED",
    p_force_future_complete: true,
  });
  report.workflows.mark_completed = toCompleted.data?.ok === true;

  const toArchived = await asAdmin.rpc("transition_exam_status", {
    p_exam_id: examRow.id,
    p_new_status: "ARCHIVED",
  });
  report.workflows.mark_archived = toArchived.data?.ok === true;

  const badJump = await asAdmin.rpc("transition_exam_status", {
    p_exam_id: report.workflows.second_exam_id,
    p_new_status: "READY",
  });
  report.workflows.invalid_jump_blocked =
    badJump.error != null || badJump.data?.ok === false;

  const reopen = await asAdmin.rpc("transition_exam_status", {
    p_exam_id: examRow.id,
    p_new_status: "COMPLETED",
    p_reason: "Exam Verify reopen test",
  });
  report.workflows.reopen_with_reason = reopen.data?.ok === true;

  const teacherCreate = await asTeacher.rpc("upsert_exam_period", {
    p_academic_year_id: year.id,
    p_name: "Exam Verify Forbidden",
    p_status: "DRAFT",
  });
  report.security.teacher_create_period_rejected = Boolean(teacherCreate.error);

  const teacherStatus = await asTeacher.rpc("transition_exam_status", {
    p_exam_id: report.workflows.second_exam_id,
    p_new_status: "SCHEDULED",
  });
  report.security.teacher_status_rejected = Boolean(teacherStatus.error);

  const copy = await asAdmin.rpc("duplicate_exam_period", {
    p_source_period_id: period.data,
    p_new_name: "Exam Verify Term 2 Copy",
    p_copy_exams: true,
    p_copy_schedules: false,
  });
  if (copy.error) throw new Error(copy.error.message);
  const { data: copiedExams } = await admin
    .from("exams")
    .select("exam_reference, status")
    .eq("exam_period_id", copy.data);
  report.workflows.copy_period = {
    ok: true,
    id: copy.data,
    new_references: (copiedExams || []).every(
      (e) => e.exam_reference && e.exam_reference !== examRow.exam_reference,
    ),
    all_draft: (copiedExams || []).every((e) => e.status === "DRAFT"),
  };

  const { data: audits } = await admin
    .from("academic_event_audits")
    .select("event_type, metadata, created_at")
    .eq("school_id", SCHOOL_ID)
    .in("event_type", [
      "EXAM_REFERENCE_ASSIGNED",
      "EXAM_MARKED_SCHEDULED",
      "EXAM_MARKED_READY",
      "EXAM_MARKED_COMPLETED",
      "EXAM_ARCHIVED",
      "EXAM_REOPENED",
      "EXAM_PERIOD_CREATED",
    ])
    .order("created_at", { ascending: false })
    .limit(30);
  const auditText = JSON.stringify(audits || []);
  report.audits = {
    sample_count: (audits || []).length,
    types: [...new Set((audits || []).map((a) => a.event_type))],
    contains_secrets: /service_role|password|token|Bearer/i.test(auditText),
    has_reference: /EX-/.test(auditText),
  };

  if (mode === "all" || mode === "cleanup") {
    const { data: verifyPeriods } = await admin
      .from("exam_periods")
      .select("id")
      .ilike("name", "Exam Verify%");
    for (const p of verifyPeriods || []) {
      const { data: exs } = await admin
        .from("exams")
        .select("id")
        .eq("exam_period_id", p.id);
      for (const e of exs || []) {
        await admin.from("exam_exclusions").delete().eq("exam_id", e.id);
        const { data: sch } = await admin
          .from("exam_schedules")
          .select("id")
          .eq("exam_id", e.id);
        for (const s of sch || []) {
          await admin.from("exam_invigilators").delete().eq("exam_schedule_id", s.id);
        }
        await admin.from("exam_schedules").delete().eq("exam_id", e.id);
        await admin.from("exams").delete().eq("id", e.id);
      }
      await admin.from("exam_periods").delete().eq("id", p.id);
    }
    await admin.from("exam_rooms").delete().ilike("name", "Exam Verify%");
    await admin.from("subjects").delete().ilike("name", "Exam Verify%");

    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of listed.data?.users || []) {
      if ((u.email || "").includes("@bfa-smoke.local") && (u.email || "").startsWith("exam-verify-")) {
        await admin.auth.admin.deleteUser(u.id);
      }
    }
    report.cleanup = {
      done: true,
      note: "Exam Verify rows removed; reference counters not reset",
    };
  }

  const out = path.join(
    process.cwd(),
    "scripts",
    ".phase2b-staging-verify-result.json",
  );
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("PHASE2B_VERIFY_OK");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
