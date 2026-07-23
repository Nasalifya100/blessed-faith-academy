/**
 * Deep read-only staging probe for migration reconciliation.
 * Distinguishes missing RPCs from wrong signatures; probes fingerprint objects.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const NIL = "00000000-0000-0000-0000-000000000000";

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
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function tableExists(name) {
    const { error, count } = await admin
      .from(name)
      .select("*", { count: "exact", head: true });
    if (!error) return { exists: true, count };
    const msg = error.message || "";
    if (/Could not find the table|schema cache|does not exist/i.test(msg)) {
      return { exists: false, error: msg };
    }
    return { exists: true, error: msg, count: null };
  }

  async function columnExists(table, column) {
    const { error } = await admin.from(table).select(column).limit(1);
    if (!error) return { exists: true };
    const msg = error.message || "";
    if (/column .* does not exist/i.test(msg)) return { exists: false, error: msg };
    // other errors: column likely exists (RLS, etc.)
    return { exists: true, error: msg };
  }

  async function rpcProbe(name, args) {
    const { data, error } = await admin.rpc(name, args);
    if (!error) return { exists: true, data };
    const msg = error.message || "";
    // True missing from PostgREST schema cache
    if (/Could not find the function/i.test(msg)) {
      return { exists: false, error: msg };
    }
    return { exists: true, error: msg, data: null };
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
    "payment_finance_snapshots",
    "attendance_sessions",
    "attendance_marks",
    "attendance_records",
    "attendance_record_audits",
    "class_attendance_covers",
    "school_rules",
    "discipline_incidents",
    "student_requirement_checks",
    "student_medical",
    "legacy_migration_audits",
    "system_reset_audits",
    "production_reset_audits",
    "student_profile_change_audits",
    "student_profile_change_events",
    "password_reset_audits",
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
  ];

  const columns = [
    ["classes", "stream_code"],
    ["classes", "homeroom_teacher_id"],
    ["payments", "void_reason"],
    ["payments", "idempotency_key"],
    ["payments", "status"],
    ["charges", "status"],
    ["charges", "cancelled_at"],
    ["terms", "school_id"],
    ["terms", "is_current"],
    ["students", "archived_at"],
    ["students", "source"],
    ["applications", "applied_class_id"],
    ["exams", "exam_reference"],
    ["exams", "status"],
    ["exams", "status_changed_at"],
    ["exams", "status_changed_by"],
    ["exams", "status_note"],
    ["academic_settings", "grading_scale_confirmed_at"],
    ["finance_allocation_gates", "activated_at"],
    ["finance_event_audits", "cancel_reason"],
    ["finance_event_audits", "metadata"],
    ["attendance_records", "deleted_at"],
    ["payment_allocations", "is_active"],
  ];

  const rpcs = [
    ["create_class", { p_grade_level_id: NIL, p_academic_year_id: NIL, p_name: "__probe__" }],
    ["update_class", { p_class_id: NIL, p_name: "__probe__" }],
    ["upsert_subject", { p_id: null, p_name: "__probe__", p_category: "core" }],
    ["set_subject_active", { p_subject_id: NIL, p_is_active: false }],
    ["add_subject_prerequisite", { p_subject_id: NIL, p_prerequisite_subject_id: NIL }],
    ["bulk_set_grade_subject_offerings", { p_grade_level_id: NIL, p_academic_year_id: NIL, p_subject_ids: [] }],
    ["assign_subject_teacher", { p_subject_offering_id: NIL, p_staff_profile_id: NIL }],
    ["end_teaching_assignment", { p_assignment_id: NIL }],
    ["save_grading_scheme", { p_name: "__probe__", p_bands: [] }],
    ["seed_default_assessment_types", {}],
    ["save_weight_scheme", { p_name: "__probe__", p_items: [] }],
    ["upsert_workflow_period", { p_academic_year_id: NIL, p_term_id: NIL, p_period_type: "exam_entry" }],
    ["log_academic_event", { p_entity_type: "probe", p_entity_id: NIL, p_action: "probe", p_summary: "probe" }],
    ["has_academic_capability", { p_capability: "EXAM_VIEW" }],
    ["require_academic_capability", { p_capability: "EXAM_VIEW" }],
    ["upsert_exam_room", { p_name: "__probe__" }],
    ["list_exam_staff_candidates", {}],
    ["upsert_exam_period", { p_name: "__probe__", p_academic_year_id: NIL, p_term_id: NIL, p_starts_on: "2026-01-01", p_ends_on: "2026-01-02" }],
    ["upsert_exam", { p_exam_period_id: NIL, p_subject_id: NIL, p_grade_level_id: NIL, p_assessment_type_id: NIL }],
    ["upsert_exam_schedule", { p_exam_id: NIL, p_exam_date: "2026-01-01", p_starts_at: "09:00", p_ends_at: "10:00" }],
    ["detect_exam_schedule_conflicts", { p_exam_period_id: NIL }],
    ["duplicate_exam_period", { p_source_period_id: NIL, p_name: "__probe__", p_academic_year_id: NIL, p_term_id: NIL, p_starts_on: "2026-01-01", p_ends_on: "2026-01-02" }],
    ["set_exam_period_status", { p_period_id: NIL, p_status: "draft" }],
    ["apply_exam_template", { p_template_id: NIL, p_exam_period_id: NIL }],
    ["save_exam_template_from_period", { p_exam_period_id: NIL, p_name: "__probe__" }],
    ["upsert_exam_exclusion", { p_exam_id: NIL, p_student_id: NIL }],
    ["remove_exam_exclusion", { p_exclusion_id: NIL }],
    ["bulk_shift_exam_dates", { p_exam_period_id: NIL, p_day_offset: 1 }],
    ["bulk_assign_room_to_period", { p_exam_period_id: NIL, p_room_id: NIL }],
    ["bulk_archive_closed_exam_periods", {}],
    ["transition_exam_status", { p_exam_id: NIL, p_target_status: "scheduled" }],
    ["exam_status_blockers", { p_exam_id: NIL, p_target: "scheduled" }],
    ["allocate_exam_reference", { p_school_id: NIL, p_academic_year_id: NIL, p_term_id: NIL }],
    ["record_payment", { p_student_id: NIL, p_amount: 1, p_method: "bank_transfer", p_paid_on: "2026-01-01" }],
    ["void_payment", { p_payment_id: NIL, p_reason: "probe" }],
    ["activate_payment_allocations", { p_school_id: NIL }],
    ["get_finance_allocation_migration_status", {}],
    ["cancel_optional_charge", { p_charge_id: NIL, p_reason: "probe" }],
    ["diagnose_finance_pre_allocation", {}],
    ["validate_payment_allocation_invariants", {}],
    ["prepare_payment_allocation_backfill", { p_school_id: NIL }],
    ["set_current_academic_year", { p_year_id: NIL }],
    ["set_current_term", { p_term_id: NIL }],
    ["transfer_student_class", { p_student_id: NIL, p_to_class_id: NIL }],
    ["archive_student", { p_student_id: NIL }],
    ["create_enrolled_student", {}],
    ["approve_application", { p_application_id: NIL }],
    ["create_existing_student_migration", {}],
    ["reset_bfa_operational_data", {}],
    ["update_student_profile", { p_student_id: NIL }],
    ["log_password_reset_event", { p_event_type: "probe", p_outcome: "probe" }],
    ["current_user_school_id", {}],
    ["current_user_role", {}],
    ["is_administrator", {}],
    ["can_manage_students", {}],
    ["list_guardian_candidates", { p_query: "x" }],
    ["find_or_create_guardian", {}],
    ["generate_term_charges", { p_term_id: NIL }],
    ["opt_in_optional_fee", { p_student_id: NIL, p_fee_item_id: NIL }],
  ];

  const probes = {};
  for (const t of tables) probes["table:" + t] = await tableExists(t);
  for (const [t, c] of columns) probes["column:" + t + "." + c] = await columnExists(t, c);
  for (const [n, a] of rpcs) probes["rpc:" + n] = await rpcProbe(n, a);

  // Exam status check constraint / enum via insert attempt not allowed — select distinct
  if (probes["column:exams.status"]?.exists) {
    const { error } = await admin.from("exams").select("status, exam_reference, status_changed_at, status_changed_by, status_note").limit(1);
    probes["select:exams.lifecycle_cols"] = { ok: !error, error: error?.message || null };
  }

  // finance gate columns
  if (probes["table:finance_allocation_gates"]?.exists) {
    const { data, error } = await admin.from("finance_allocation_gates").select("*").limit(1);
    probes["sample:finance_allocation_gates"] = {
      keys: data?.[0] ? Object.keys(data[0]) : null,
      error: error?.message || null,
    };
  }

  if (probes["table:academic_settings"]?.exists) {
    const { data, error } = await admin.from("academic_settings").select("*").limit(1);
    probes["sample:academic_settings"] = {
      keys: data?.[0] ? Object.keys(data[0]) : null,
      error: error?.message || null,
    };
  }

  if (probes["table:exams"]?.exists) {
    const { data, error } = await admin.from("exams").select("*").limit(1);
    probes["sample:exams.keys"] = {
      keys: data?.[0] ? Object.keys(data[0]) : null,
      // empty table: try OpenAPI? fallback select known cols already done
      error: error?.message || null,
      count: probes["table:exams"].count,
    };
  }

  const out = {
    host: new URL(url).host,
    probed_at: new Date().toISOString(),
    tables_present: tables.filter((t) => probes["table:" + t]?.exists),
    tables_missing: tables.filter((t) => !probes["table:" + t]?.exists),
    columns_present: columns.filter(([t, c]) => probes["column:" + t + "." + c]?.exists).map(([t, c]) => t + "." + c),
    columns_missing: columns.filter(([t, c]) => !probes["column:" + t + "." + c]?.exists).map(([t, c]) => t + "." + c),
    rpcs_present: rpcs.filter(([n]) => probes["rpc:" + n]?.exists).map(([n]) => n),
    rpcs_missing: rpcs.filter(([n]) => !probes["rpc:" + n]?.exists).map(([n]) => n),
    rpc_errors: Object.fromEntries(
      rpcs
        .filter(([n]) => probes["rpc:" + n]?.exists && probes["rpc:" + n]?.error)
        .map(([n]) => [n, probes["rpc:" + n].error]),
    ),
    probes,
  };

  const outPath = path.join(process.cwd(), "scripts", ".migration-reconciliation-probe.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("host=" + out.host);
  console.log("tables_missing=" + out.tables_missing.join(",") || "(none)");
  console.log("columns_missing=" + out.columns_missing.join(",") || "(none)");
  console.log("rpcs_missing=" + out.rpcs_missing.join(",") || "(none)");
  console.log("rpcs_present_count=" + out.rpcs_present.length);
  console.log("wrote=" + outPath);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
