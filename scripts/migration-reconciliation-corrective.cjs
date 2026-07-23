/**
 * Corrective read-only probe: fixed RPC signatures + stricter table existence.
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
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function tableStrict(name) {
    const { data, error, count, status } = await admin
      .from(name)
      .select("id", { count: "exact", head: false })
      .limit(1);
    const msg = error?.message || "";
    const missing = /Could not find the table|schema cache|relation .* does not exist/i.test(msg);
    return {
      exists: !missing && (!error || !/does not exist/i.test(msg)),
      missing,
      count: count ?? null,
      status,
      error: msg || null,
      sampleKeys: data?.[0] ? Object.keys(data[0]) : null,
    };
  }

  async function cols(table, list) {
    const out = {};
    for (const c of list) {
      const { error } = await admin.from(table).select(c).limit(1);
      const msg = error?.message || "";
      out[c] = /column .* does not exist/i.test(msg)
        ? { exists: false, error: msg }
        : { exists: !error || true, error: msg || null };
    }
    return out;
  }

  async function rpc(name, args) {
    const { error } = await admin.rpc(name, args);
    const msg = error?.message || "";
    if (/Could not find the function/i.test(msg)) return { exists: false, error: msg };
    return { exists: true, error: msg || null };
  }

  const dubiousTables = [
    "attendance_sessions",
    "attendance_marks",
    "attendance_records",
    "production_reset_audits",
    "system_reset_audits",
    "student_profile_change_events",
    "student_profile_change_audits",
    "requirement_items",
    "payment_finance_snapshots",
    "exam_reference_counters",
  ];

  const tables = {};
  for (const t of dubiousTables) tables[t] = await tableStrict(t);

  const columnChecks = {
    students: await cols("students", [
      "archived_at",
      "archive_reason",
      "place_of_birth",
      "religious_denomination",
      "previous_school",
      "proposed_admission_date",
      "is_zambian_citizen",
      "record_origin",
      "legacy_reference",
    ]),
    guardians: await cols("guardians", ["whatsapp", "postal_address"]),
    applications: await cols("applications", [
      "applied_class_id",
      "emergency_contact_phone",
      "media_release_agreed",
    ]),
    payments: await cols("payments", [
      "void_reason",
      "voided_at",
      "voided_by",
      "idempotency_key",
    ]),
    charges: await cols("charges", [
      "status",
      "charge_source",
      "legacy_reference",
      "cancelled_at",
    ]),
    exams: await cols("exams", [
      "exam_reference",
      "status",
      "status_changed_at",
      "status_changed_by",
      "status_reason",
    ]),
    finance_allocation_gates: await cols("finance_allocation_gates", [
      "activated_at",
      "activated_by",
    ]),
    finance_event_audits: await cols("finance_event_audits", ["metadata", "event_type"]),
    attendance_records: await cols("attendance_records", ["deleted_at", "school_id"]),
    payment_allocations: await cols("payment_allocations", [
      "is_active",
      "payment_id",
      "charge_id",
      "amount",
    ]),
    schools: await cols("schools", ["admission_prefix", "receipt_prefix"]),
    classes: await cols("classes", ["stream_code", "homeroom_teacher_id"]),
    terms: await cols("terms", ["school_id", "is_current"]),
  };

  const rpcs = {};
  const rpcList = [
    ["transition_exam_status", { p_exam_id: NIL, p_new_status: "SCHEDULED" }],
    ["exam_status_blockers", { p_exam_id: NIL, p_target: "SCHEDULED" }],
    ["allocate_exam_reference", { p_school_id: NIL, p_academic_year_id: NIL, p_term_id: NIL }],
    [
      "upsert_exam_period",
      {
        p_academic_year_id: NIL,
        p_term_id: NIL,
        p_name: "__probe__",
        p_opens_on: "2026-01-01",
        p_closes_on: "2026-01-02",
      },
    ],
    [
      "duplicate_exam_period",
      { p_source_period_id: NIL, p_new_name: "__probe__" },
    ],
    [
      "upsert_exam_schedule",
      {
        p_exam_id: NIL,
        p_exam_date: "2026-01-01",
        p_start_time: "09:00",
        p_end_time: "10:00",
      },
    ],
    [
      "detect_exam_schedule_conflicts",
      {
        p_exam_id: NIL,
        p_exam_date: "2026-01-01",
        p_start_time: "09:00",
        p_end_time: "10:00",
      },
    ],
    [
      "save_exam_template_from_period",
      { p_exam_period_id: NIL, p_name: "__probe__" },
    ],
    [
      "assign_subject_teacher",
      { p_subject_offering_id: NIL, p_staff_id: NIL },
    ],
    [
      "bulk_set_grade_subject_offerings",
      { p_academic_year_id: NIL, p_grade_level_id: NIL, p_items: [] },
    ],
    ["save_grading_scheme", { p_id: null, p_name: "__probe__", p_bands: [] }],
    ["save_weight_scheme", { p_id: null, p_name: "__probe__", p_items: [] }],
    [
      "upsert_workflow_period",
      {
        p_academic_year_id: NIL,
        p_term_id: NIL,
        p_workflow_type: "exam_entry",
        p_starts_at: "2026-01-01",
      },
    ],
    [
      "log_academic_event",
      {
        p_event_type: "PROBE",
        p_entity_type: "probe",
        p_entity_id: NIL,
      },
    ],
    [
      "record_payment",
      {
        p_student_id: NIL,
        p_amount: 1,
        p_method: "bank_transfer",
        p_idempotency_key: NIL,
      },
    ],
    ["transfer_student_class", { p_student_id: NIL, p_to_class_id: NIL }],
    ["create_enrolled_student", { p_first_name: "P", p_last_name: "R", p_class_id: NIL }],
    ["approve_application", { p_application_id: NIL }],
    ["create_application", { p_first_name: "P", p_last_name: "R" }],
    ["reject_application", { p_application_id: NIL, p_reason: "probe" }],
    ["create_charges_for_student", { p_student_id: NIL, p_term_id: NIL }],
    ["create_charges_for_class", { p_class_id: NIL, p_term_id: NIL }],
    ["create_optional_charge", { p_student_id: NIL, p_fee_item_id: NIL }],
    ["set_requirement_received", { p_student_id: NIL, p_requirement_item_id: NIL, p_received: true }],
    ["can_take_attendance", {}],
    ["save_class_attendance", { p_class_id: NIL, p_attendance_date: "2026-01-01", p_marks: [] }],
    ["list_classes_for_attendance", { p_attendance_date: "2026-01-01" }],
    ["list_teachers_for_cover", {}],
    ["set_class_homeroom_teacher", { p_class_id: NIL, p_teacher_id: NIL }],
    ["create_discipline_incident", { p_student_id: NIL, p_school_rule_id: NIL, p_notes: "x" }],
    ["can_manage_school_rules", {}],
    ["can_record_discipline", {}],
    ["upsert_student_medical", { p_student_id: NIL }],
    ["find_or_create_guardian", { p_full_name: "Probe", p_phone: "260000000000" }],
    ["list_guardian_candidates", { p_query: "x" }],
    [
      "create_existing_student_migration",
      { p_first_name: "P", p_last_name: "R", p_class_id: NIL },
    ],
    ["update_student_profile", { p_student_id: NIL }],
    ["update_guardian_profile", { p_guardian_id: NIL }],
    ["count_guardian_linked_students", { p_guardian_id: NIL }],
    ["log_password_reset_event", { p_event_type: "probe", p_outcome: "probe" }],
    ["allocate_payment_to_charges", { p_payment_id: NIL }],
    ["get_student_finance_summary", { p_student_id: NIL }],
    ["finance_allocations_are_active", { p_school_id: NIL }],
    ["apply_available_credit", { p_student_id: NIL }],
    ["get_void_payment_preview", { p_payment_id: NIL }],
    ["run_payment_allocation_backfill", { p_school_id: NIL }],
    ["backfill_payment_allocations_for_school", { p_school_id: NIL }],
    ["suggest_admission_number", {}],
    ["suggest_receipt_number", {}],
    ["can_manage_fees", {}],
    ["can_review_applications", {}],
    ["assign_attendance_cover", { p_class_id: NIL, p_cover_teacher_id: NIL, p_starts_on: "2026-01-01", p_ends_on: "2026-01-02" }],
  ];

  for (const [n, a] of rpcList) rpcs[n] = await rpc(n, a);

  // school_rules seed evidence
  const { data: rules } = await admin.from("school_rules").select("title").limit(20);
  const { data: gate } = await admin.from("finance_allocation_gates").select("*").limit(1);
  const { data: settings } = await admin.from("academic_settings").select("*").limit(1);

  const out = {
    host: new URL(env.NEXT_PUBLIC_SUPABASE_URL).host,
    probed_at: new Date().toISOString(),
    tables,
    columns: columnChecks,
    rpcs_present: Object.entries(rpcs).filter(([, v]) => v.exists).map(([k]) => k),
    rpcs_missing: Object.entries(rpcs).filter(([, v]) => !v.exists).map(([k]) => k),
    rpc_errors: Object.fromEntries(
      Object.entries(rpcs)
        .filter(([, v]) => v.exists && v.error)
        .map(([k, v]) => [k, v.error]),
    ),
    rpc_missing_detail: Object.fromEntries(
      Object.entries(rpcs)
        .filter(([, v]) => !v.exists)
        .map(([k, v]) => [k, v.error]),
    ),
    school_rule_titles: (rules || []).map((r) => r.title),
    finance_gate_keys: gate?.[0] ? Object.keys(gate[0]) : null,
    academic_settings_keys: settings?.[0] ? Object.keys(settings[0]) : null,
  };

  const outPath = path.join(
    process.cwd(),
    "scripts",
    ".migration-reconciliation-corrective.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("missing_tables=" + Object.entries(tables).filter(([, v]) => v.missing).map(([k]) => k).join(",") || "(none)");
  console.log("dubious_table_errors=");
  for (const [k, v] of Object.entries(tables)) {
    if (v.error) console.log("  " + k + ": " + v.error.slice(0, 120));
  }
  console.log("rpcs_missing=" + out.rpcs_missing.join(",") || "(none)");
  console.log("rpcs_present_count=" + out.rpcs_present.length);
  console.log("exams_cols=" + JSON.stringify(columnChecks.exams));
  console.log("wrote=" + outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
