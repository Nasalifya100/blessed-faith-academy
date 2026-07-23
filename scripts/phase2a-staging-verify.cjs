/**
 * Phase 2A staging: structure check, controlled Academic Verify data via RPCs
 * (disposable admin session), security denials, audit inspection, cleanup.
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
const VERIFY_ADMIN_EMAIL = "academic-verify-admin@bfa-smoke.local";
const VERIFY_TEACHER_EMAIL = "academic-verify-teacher@bfa-smoke.local";
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
    baseline: {},
    workflows: {},
    security: {},
    audits: {},
    cleanup: {},
  };

  // Structure
  const tables = [
    "subjects",
    "subject_prerequisites",
    "subject_offerings",
    "teaching_assignments",
    "grading_schemes",
    "grading_scheme_bands",
    "assessment_types",
    "assessment_weight_schemes",
    "assessment_weight_items",
    "academic_workflow_periods",
    "academic_event_audits",
    "academic_capabilities",
    "academic_settings",
  ];
  for (const t of tables) {
    const { error, count } = await admin
      .from(t)
      .select("*", { count: "exact", head: true });
    report.structure[t] = error ? { ok: false, error: error.message } : { ok: true, count };
  }
  const { data: classSample } = await admin
    .from("classes")
    .select("id, name, stream_code")
    .eq("school_id", SCHOOL_ID)
    .limit(5);
  report.structure.stream_code_column = classSample
    ? Object.prototype.hasOwnProperty.call(classSample[0] || { stream_code: null }, "stream_code")
    : false;
  report.baseline.classes = (
    await admin
      .from("classes")
      .select("*", { count: "exact", head: true })
      .eq("school_id", SCHOOL_ID)
  ).count;
  report.baseline.profiles = (
    await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("school_id", SCHOOL_ID)
      .eq("is_active", true)
  ).count;

  const missing = Object.entries(report.structure)
    .filter(([k, v]) => typeof v === "object" && v && "ok" in v && !v.ok)
    .map(([k]) => k);
  if (missing.length) {
    console.log(JSON.stringify(report, null, 2));
    throw new Error("Missing tables: " + missing.join(", "));
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
  const { data: grade7 } = await admin
    .from("grade_levels")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .eq("name", "Grade 7")
    .maybeSingle();
  const { data: term } = await admin
    .from("terms")
    .select("id, name")
    .eq("academic_year_id", year.id)
    .eq("is_current", true)
    .maybeSingle();

  if (!year || !grade7) throw new Error("Missing current year or Grade 7");

  await ensureAuthUser(
    admin,
    VERIFY_ADMIN_EMAIL,
    "administrator",
    "Academic Verify Admin",
  );
  await ensureAuthUser(
    admin,
    VERIFY_TEACHER_EMAIL,
    "teacher",
    "Academic Verify Teacher",
  );

  const { supabase: asAdmin, user: adminUser } = await signedClient(
    env,
    VERIFY_ADMIN_EMAIL,
  );
  const { supabase: asTeacher, user: teacherUser } = await signedClient(
    env,
    VERIFY_TEACHER_EMAIL,
  );

  // 1) Class streams
  const classA = await asAdmin.rpc("create_class", {
    p_grade_level_id: grade7.id,
    p_academic_year_id: year.id,
    p_name: "Academic Verify Grade 7A",
    p_stream_code: "A",
    p_capacity: null,
  });
  report.workflows.class_a = classA.error
    ? { ok: false, error: classA.error.message }
    : { ok: true, id: classA.data };

  const classB = await asAdmin.rpc("create_class", {
    p_grade_level_id: grade7.id,
    p_academic_year_id: year.id,
    p_name: "Academic Verify Grade 7B",
    p_stream_code: "B",
    p_capacity: null,
  });
  report.workflows.class_b = classB.error
    ? { ok: false, error: classB.error.message }
    : { ok: true, id: classB.data };

  const classDup = await asAdmin.rpc("create_class", {
    p_grade_level_id: grade7.id,
    p_academic_year_id: year.id,
    p_name: "Academic Verify Grade 7A",
    p_stream_code: "A",
    p_capacity: null,
  });
  report.workflows.class_duplicate_rejected = Boolean(classDup.error);

  // 2) Subjects
  const math = await asAdmin.rpc("upsert_subject", {
    p_id: null,
    p_name: "Academic Verify Mathematics",
    p_short_name: "AV Math",
    p_code: "AV-MATH",
    p_category: "CORE",
    p_description: null,
    p_display_order: 1,
    p_is_active: true,
  });
  const eng = await asAdmin.rpc("upsert_subject", {
    p_id: null,
    p_name: "Academic Verify English",
    p_short_name: "AV Eng",
    p_code: "AV-ENG",
    p_category: "CORE",
    p_description: null,
    p_display_order: 2,
    p_is_active: true,
  });
  report.workflows.subject_math = math.error
    ? { ok: false, error: math.error.message }
    : { ok: true, id: math.data };
  report.workflows.subject_eng = eng.error
    ? { ok: false, error: eng.error.message }
    : { ok: true, id: eng.data };

  const dupSubj = await asAdmin.rpc("upsert_subject", {
    p_id: null,
    p_name: "academic verify mathematics",
    p_short_name: null,
    p_code: null,
    p_category: "CORE",
    p_description: null,
    p_display_order: 0,
    p_is_active: true,
  });
  report.workflows.subject_duplicate_rejected = Boolean(dupSubj.error);

  // 3) Prerequisites
  const prereq = await asAdmin.rpc("add_subject_prerequisite", {
    p_subject_id: eng.data,
    p_prerequisite_subject_id: math.data,
    p_notes: "Academic Verify prerequisite",
  });
  report.workflows.prerequisite = prereq.error
    ? { ok: false, error: prereq.error.message }
    : { ok: true, id: prereq.data };
  const selfPrereq = await asAdmin.rpc("add_subject_prerequisite", {
    p_subject_id: math.data,
    p_prerequisite_subject_id: math.data,
    p_notes: null,
  });
  report.workflows.prerequisite_self_rejected = Boolean(selfPrereq.error);

  // 4) Offerings
  const offerings = await asAdmin.rpc("bulk_set_grade_subject_offerings", {
    p_academic_year_id: year.id,
    p_grade_level_id: grade7.id,
    p_items: [
      { subject_id: math.data, is_compulsory: true },
      { subject_id: eng.data, is_compulsory: true },
    ],
  });
  report.workflows.offerings = offerings.error
    ? { ok: false, error: offerings.error.message }
    : { ok: true, count: offerings.data };

  const { data: offeringRows } = await admin
    .from("subject_offerings")
    .select("id, subject_id")
    .eq("academic_year_id", year.id)
    .eq("grade_level_id", grade7.id)
    .eq("is_active", true)
    .in("subject_id", [math.data, eng.data]);

  // 5) Teaching assignment
  const assign = await asAdmin.rpc("assign_subject_teacher", {
    p_subject_offering_id: offeringRows?.[0]?.id,
    p_staff_id: teacherUser.id,
    p_class_id: classA.data || null,
    p_role_type: "SUBJECT_TEACHER",
    p_is_primary: true,
    p_effective_from: null,
    p_effective_to: null,
  });
  report.workflows.assignment = assign.error
    ? { ok: false, error: assign.error.message }
    : { ok: true, id: assign.data };

  const selfAssign = await asTeacher.rpc("assign_subject_teacher", {
    p_subject_offering_id: offeringRows?.[0]?.id,
    p_staff_id: teacherUser.id,
    p_class_id: null,
  });
  report.security.teacher_self_assign_rejected = Boolean(selfAssign.error);

  const teacherCreateSubject = await asTeacher.rpc("upsert_subject", {
    p_id: null,
    p_name: "Academic Verify Forbidden Subject",
    p_short_name: null,
    p_code: null,
    p_category: "CORE",
    p_description: null,
    p_display_order: 0,
    p_is_active: true,
  });
  report.security.teacher_create_subject_rejected = Boolean(
    teacherCreateSubject.error,
  );

  // 6) Grading scale
  const bands = [
    {
      minimum_score: 80,
      maximum_score: 100,
      grade_code: "D",
      grade_label: "Distinction",
      is_pass: true,
      display_order: 1,
    },
    {
      minimum_score: 70,
      maximum_score: 79.99,
      grade_code: "M",
      grade_label: "Merit",
      is_pass: true,
      display_order: 2,
    },
    {
      minimum_score: 60,
      maximum_score: 69.99,
      grade_code: "C",
      grade_label: "Credit",
      is_pass: true,
      display_order: 3,
    },
    {
      minimum_score: 50,
      maximum_score: 59.99,
      grade_code: "P",
      grade_label: "Pass",
      is_pass: true,
      display_order: 4,
    },
    {
      minimum_score: 0,
      maximum_score: 49.99,
      grade_code: "F",
      grade_label: "Fail",
      is_pass: false,
      display_order: 5,
    },
  ];
  const grading = await asAdmin.rpc("save_grading_scheme", {
    p_id: null,
    p_name: "Academic Verify Grading Scale",
    p_bands: bands,
    p_make_default: false,
    p_confirm: true,
  });
  report.workflows.grading = grading.error
    ? { ok: false, error: grading.error.message }
    : { ok: true, id: grading.data };

  const overlap = await asAdmin.rpc("save_grading_scheme", {
    p_id: null,
    p_name: "Academic Verify Bad Scale",
    p_bands: [
      {
        minimum_score: 50,
        maximum_score: 70,
        grade_code: "A",
        grade_label: "A",
        is_pass: true,
      },
      {
        minimum_score: 65,
        maximum_score: 80,
        grade_code: "B",
        grade_label: "B",
        is_pass: true,
      },
    ],
    p_make_default: false,
    p_confirm: false,
  });
  report.workflows.grading_overlap_rejected = Boolean(overlap.error);

  // 7) Assessment types + weights
  const seeded = await asAdmin.rpc("seed_default_assessment_types");
  report.workflows.assessment_types_seeded = seeded.error
    ? { ok: false, error: seeded.error.message }
    : { ok: true, count: seeded.data };

  const { data: types } = await admin
    .from("assessment_types")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .eq("is_active", true);
  const byName = new Map((types || []).map((t) => [t.name.toLowerCase(), t.id]));
  const weightItems = [
    {
      assessment_type_id: byName.get("assignment"),
      weight_percentage: 10,
      display_order: 1,
    },
    {
      assessment_type_id: byName.get("test"),
      weight_percentage: 20,
      display_order: 2,
    },
    {
      assessment_type_id: byName.get("mid-term examination"),
      weight_percentage: 30,
      display_order: 3,
    },
    {
      assessment_type_id: byName.get("end-of-term examination"),
      weight_percentage: 40,
      display_order: 4,
    },
  ].filter((i) => i.assessment_type_id);

  const weightsOk = await asAdmin.rpc("save_weight_scheme", {
    p_id: null,
    p_name: "Academic Verify Weight Scheme",
    p_items: weightItems,
    p_make_default: false,
    p_confirm: true,
    p_academic_year_id: year.id,
  });
  report.workflows.weights_100 = weightsOk.error
    ? { ok: false, error: weightsOk.error.message }
    : { ok: true, id: weightsOk.data };

  const weightsBad = await asAdmin.rpc("save_weight_scheme", {
    p_id: null,
    p_name: "Academic Verify Bad Weights",
    p_items: weightItems.map((i, idx) =>
      idx === 0 ? { ...i, weight_percentage: 0 } : i,
    ),
    p_make_default: false,
    p_confirm: false,
    p_academic_year_id: year.id,
  });
  report.workflows.weights_90_rejected = Boolean(weightsBad.error);

  // 8) Academic dates
  const dates = await asAdmin.rpc("upsert_workflow_period", {
    p_academic_year_id: year.id,
    p_term_id: term?.id || null,
    p_workflow_type: "MARKS_ENTRY",
    p_starts_at: "2026-04-03",
    p_ends_at: "2026-04-10",
    p_notes: "Academic Verify marks entry window",
  });
  report.workflows.dates = dates.error
    ? { ok: false, error: dates.error.message }
    : { ok: true, id: dates.data };

  // Audits
  const { data: audits } = await admin
    .from("academic_event_audits")
    .select("event_type, entity_type, actor_id, metadata, created_at")
    .eq("school_id", SCHOOL_ID)
    .order("created_at", { ascending: false })
    .limit(40);
  const typesSeen = [...new Set((audits || []).map((a) => a.event_type))];
  report.audits.recent_event_types = typesSeen;
  report.audits.sample_count = (audits || []).length;
  const auditJson = JSON.stringify(audits || []).toLowerCase();
  report.audits.contains_secrets = [
    "password",
    "service_role",
    "access_token",
    "refresh_token",
  ].some((k) => auditJson.includes(k));

  // Cleanup Academic Verify artefacts (keep seeded assessment types)
  if (mode === "all" || mode === "cleanup") {
    if (assign.data) {
      await asAdmin.rpc("end_teaching_assignment", {
        p_assignment_id: assign.data,
        p_effective_to: null,
      });
    }

    const { data: avSubjects } = await admin
      .from("subjects")
      .select("id")
      .ilike("name", "Academic Verify%");
    const subjectIds = (avSubjects || []).map((s) => s.id);
    if (subjectIds.length) {
      await admin
        .from("subject_prerequisites")
        .delete()
        .or(
          `subject_id.in.(${subjectIds.join(",")}),prerequisite_subject_id.in.(${subjectIds.join(",")})`,
        );
      const { data: offs } = await admin
        .from("subject_offerings")
        .select("id")
        .in("subject_id", subjectIds);
      const offIds = (offs || []).map((o) => o.id);
      if (offIds.length) {
        await admin
          .from("teaching_assignments")
          .delete()
          .in("subject_offering_id", offIds);
        await admin.from("subject_offerings").delete().in("id", offIds);
      }
      await admin.from("subjects").delete().in("id", subjectIds);
    }

    const { data: avClasses } = await admin
      .from("classes")
      .select("id")
      .ilike("name", "Academic Verify%");
    if (avClasses?.length) {
      await admin
        .from("classes")
        .delete()
        .in(
          "id",
          avClasses.map((c) => c.id),
        );
    }

    const { data: avSchemes } = await admin
      .from("grading_schemes")
      .select("id")
      .ilike("name", "Academic Verify%");
    if (avSchemes?.length) {
      await admin
        .from("grading_scheme_bands")
        .delete()
        .in(
          "grading_scheme_id",
          avSchemes.map((s) => s.id),
        );
      await admin
        .from("grading_schemes")
        .delete()
        .in(
          "id",
          avSchemes.map((s) => s.id),
        );
    }

    const { data: avWeights } = await admin
      .from("assessment_weight_schemes")
      .select("id")
      .ilike("name", "Academic Verify%");
    if (avWeights?.length) {
      await admin
        .from("assessment_weight_items")
        .delete()
        .in(
          "scheme_id",
          avWeights.map((s) => s.id),
        );
      await admin
        .from("assessment_weight_schemes")
        .delete()
        .in(
          "id",
          avWeights.map((s) => s.id),
        );
    }

    await admin
      .from("academic_workflow_periods")
      .delete()
      .ilike("notes", "Academic Verify%");

    // Remove disposable auth users
    for (const email of [VERIFY_ADMIN_EMAIL, VERIFY_TEACHER_EMAIL]) {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const u = (listed.data?.users || []).find(
        (x) => (x.email || "").toLowerCase() === email,
      );
      if (u) await admin.auth.admin.deleteUser(u.id);
    }

    report.cleanup = {
      subjects: subjectIds.length,
      classes: avClasses?.length || 0,
      schemes: avSchemes?.length || 0,
      weights: avWeights?.length || 0,
      disposable_auth_removed: true,
    };
  }

  const outPath = path.join(
    process.cwd(),
    "scripts",
    ".phase2a-staging-verify-result.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("wrote " + outPath);
  console.log(
    JSON.stringify(
      {
        structure_ok: missing.length === 0,
        class_streams_ok:
          report.workflows.class_a?.ok &&
          report.workflows.class_b?.ok &&
          report.workflows.class_duplicate_rejected,
        subjects_ok:
          report.workflows.subject_math?.ok &&
          report.workflows.subject_eng?.ok &&
          report.workflows.subject_duplicate_rejected,
        security_ok:
          report.security.teacher_self_assign_rejected &&
          report.security.teacher_create_subject_rejected,
        grading_ok:
          report.workflows.grading?.ok &&
          report.workflows.grading_overlap_rejected,
        weights_ok:
          report.workflows.weights_100?.ok &&
          report.workflows.weights_90_rejected,
        audits_ok:
          (report.audits.sample_count || 0) > 0 &&
          !report.audits.contains_secrets,
        cleanup: report.cleanup,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
