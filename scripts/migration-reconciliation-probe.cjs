/**
 * Read-only staging schema probe for migration reconciliation.
 * Does not apply SQL, repair history, or print secrets.
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

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing URL or service role in .env.local");
  console.log("host=" + new URL(url).host);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Prefer RPC that lists catalog if any; otherwise table probes + pg via rpc if exists
  const probes = {};

  async function tableExists(name) {
    const { error, count } = await admin
      .from(name)
      .select("*", { count: "exact", head: true });
    if (!error) return { exists: true, count };
    const msg = error.message || "";
    if (/Could not find the table|schema cache|does not exist/i.test(msg)) {
      return { exists: false, error: msg };
    }
    // RLS or other errors still imply table exists
    return { exists: true, error: msg, count: null };
  }

  async function columnExists(table, column) {
    const { error } = await admin.from(table).select(column).limit(1);
    if (!error) return true;
    return !/column .* does not exist/i.test(error.message || "");
  }

  async function rpcExists(name, args = {}) {
    const { error } = await admin.rpc(name, args);
    if (!error) return { exists: true };
    const msg = error.message || "";
    if (/Could not find the function|schema cache/i.test(msg)) {
      return { exists: false, error: msg };
    }
    // function exists but args/auth failed
    return { exists: true, error: msg };
  }

  const tables = [
    "schools",
    "academic_years",
    "terms",
    "grade_levels",
    "classes",
    "profiles",
    "students",
    "guardians",
    "student_guardians",
    "student_class_enrollments",
    "applications",
    "fee_items",
    "fee_schedules",
    "charges",
    "payments",
    "payment_allocations",
    "finance_event_audits",
    "finance_allocation_gates",
    "attendance_sessions",
    "attendance_marks",
    "class_attendance_covers",
    "school_rules",
    "discipline_incidents",
    "student_requirement_checks",
    "academic_event_audits",
    "academic_capabilities",
    "academic_settings",
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
    "exam_rooms",
    "exam_periods",
    "exam_templates",
    "exam_template_items",
    "exams",
    "exam_schedules",
    "exam_invigilators",
    "exam_exclusions",
    "exam_reference_counters",
    "password_reset_audits",
    "student_profile_change_events",
    "production_reset_audits",
  ];

  for (const t of tables) {
    probes["table:" + t] = await tableExists(t);
  }

  const columns = [
    ["classes", "stream_code"],
    ["classes", "homeroom_teacher_id"],
    ["payments", "void_reason"],
    ["payments", "idempotency_key"],
    ["terms", "school_id"],
    ["students", "archived_at"],
    ["applications", "applied_class_id"],
    ["exams", "exam_reference"],
    ["exams", "status"],
    ["exams", "status_changed_at"],
    ["academic_settings", "grading_scale_confirmed_at"],
  ];
  for (const [table, col] of columns) {
    probes["column:" + table + "." + col] = {
      exists: await columnExists(table, col),
    };
  }

  const rpcs = [
    ["create_class", {}],
    ["upsert_subject", { p_id: null, p_name: "__probe__" }],
    ["assign_subject_teacher", {}],
    ["save_grading_scheme", {}],
    ["seed_default_assessment_types", {}],
    ["upsert_exam_room", { p_name: "__probe__" }],
    ["upsert_exam_period", {}],
    ["upsert_exam", {}],
    ["transition_exam_status", {}],
    ["allocate_exam_reference", {}],
    ["detect_exam_schedule_conflicts", {}],
    ["has_academic_capability", { p_capability: "EXAM_VIEW" }],
    ["log_academic_event", {}],
    ["record_payment", {}],
    ["activate_payment_allocations", {}],
    ["cancel_optional_charge", {}],
    ["set_current_academic_year", {}],
    ["set_current_term", {}],
    ["transfer_student_class", {}],
    ["archive_student", {}],
    ["create_enrolled_student", {}],
    ["approve_application", {}],
    ["list_exam_staff_candidates", {}],
    ["bulk_set_grade_subject_offerings", {}],
    ["end_teaching_assignment", {}],
    ["save_weight_scheme", {}],
    ["upsert_workflow_period", {}],
    ["duplicate_exam_period", {}],
    ["apply_exam_template", {}],
    ["exam_status_blockers", {}],
  ];

  for (const [name, args] of rpcs) {
    probes["rpc:" + name] = await rpcExists(name, args);
  }

  // Enum-ish: try selecting status values from exams if column exists
  if (probes["column:exams.status"]?.exists) {
    const { data, error } = await admin.from("exams").select("status").limit(1);
    probes["sample:exams.status"] = { data, error: error?.message || null };
  }

  const outPath = path.join(
    process.cwd(),
    "scripts",
    ".migration-reconciliation-probe.json",
  );
  fs.writeFileSync(outPath, JSON.stringify({ host: new URL(url).host, probes }, null, 2));
  console.log("wrote=" + outPath);
  console.log("tables_ok=" + tables.filter((t) => probes["table:" + t]?.exists).length);
  console.log(
    "tables_missing=" +
      tables.filter((t) => !probes["table:" + t]?.exists).join(","),
  );
  console.log(
    "columns=" +
      columns
        .map(
          ([t, c]) =>
            t + "." + c + "=" + probes["column:" + t + "." + c]?.exists,
        )
        .join(";"),
  );
  console.log(
    "rpcs_present=" +
      rpcs.filter(([n]) => probes["rpc:" + n]?.exists).map(([n]) => n).join(","),
  );
  console.log(
    "rpcs_missing=" +
      rpcs.filter(([n]) => !probes["rpc:" + n]?.exists).map(([n]) => n).join(","),
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
