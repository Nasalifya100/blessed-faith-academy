/** Final signature fixes — read-only. */
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

  async function rpc(name, args) {
    const { error } = await admin.rpc(name, args);
    const msg = error?.message || "";
    return {
      exists: !/Could not find the function/i.test(msg),
      error: msg || null,
    };
  }

  const checks = {
    list_classes_for_attendance: await rpc("list_classes_for_attendance", {}),
    can_take_attendance: await rpc("can_take_attendance", {}),
    transfer_student_class: await rpc("transfer_student_class", {
      p_student_id: NIL,
      p_new_class_id: NIL,
    }),
    save_exam_template_from_period: await rpc("save_exam_template_from_period", {
      p_period_id: NIL,
      p_template_name: "__probe__",
    }),
    set_class_homeroom_teacher: await rpc("set_class_homeroom_teacher", {
      p_class_id: NIL,
      p_homeroom_teacher_id: NIL,
    }),
    assign_attendance_cover: await rpc("assign_attendance_cover", {
      p_class_id: NIL,
      p_teacher_id: NIL,
      p_starts_on: "2026-01-01",
      p_ends_on: "2026-01-02",
    }),
    create_discipline_incident: await rpc("create_discipline_incident", {
      p_student_id: NIL,
      p_rule_id: NIL,
      p_description: "probe",
    }),
    upsert_student_medical: await rpc("upsert_student_medical", {
      p_student_id: NIL,
      p_allergies: null,
      p_conditions: null,
      p_medications: null,
      p_notes: null,
    }),
    list_guardian_candidates: await rpc("list_guardian_candidates", {
      p_search: "x",
    }),
    find_or_create_guardian: await rpc("find_or_create_guardian", {
      p_full_name: "Probe Guardian",
      p_phone: "260955000000",
      p_relationship: "parent",
    }),
    approve_application: await rpc("approve_application", {
      p_application_id: NIL,
      p_class_id: NIL,
    }),
    reject_application: await rpc("reject_application", {
      p_application_id: NIL,
      p_notes: "probe",
    }),
    set_requirement_received: await rpc("set_requirement_received", {
      p_check_id: NIL,
      p_received: true,
    }),
    log_password_reset_event: await rpc("log_password_reset_event", {
      p_target_user_id: NIL,
      p_target_profile_id: NIL,
      p_target_email: "a@b.c",
      p_action_type: "self_service_reset_requested",
      p_initiated_by: NIL,
      p_result_status: "success",
    }),
    update_student_profile: await rpc("update_student_profile", {
      p_student_id: NIL,
      p_first_name: "P",
    }),
    update_guardian_profile: await rpc("update_guardian_profile", {
      p_guardian_id: NIL,
      p_full_name: "P",
    }),
    create_enrolled_student: await rpc("create_enrolled_student", {
      p_admission_number: "PROBE-1",
      p_first_name: "P",
      p_middle_name: null,
      p_last_name: "R",
      p_date_of_birth: "2015-01-01",
      p_gender: "male",
      p_enrollment_date: "2026-01-01",
      p_class_id: NIL,
      p_guardians: [],
    }),
    create_existing_student_migration: await rpc("create_existing_student_migration", {
      p_payload: {},
    }),
    create_application: await rpc("create_application", {
      p_payload: {},
    }),
    record_payment_cash: await rpc("record_payment", {
      p_student_id: NIL,
      p_amount: 1,
      p_method: "cash",
      p_idempotency_key: NIL,
    }),
    payment_finance_snapshots_cols: await (async () => {
      const { error } = await admin
        .from("payment_finance_snapshots")
        .select("payment_id, student_id, school_id")
        .limit(1);
      return { exists: !error || !/Could not find the table/i.test(error.message), error: error?.message || null };
    })(),
    exam_reference_counters_cols: await (async () => {
      const { error } = await admin
        .from("exam_reference_counters")
        .select("school_id, academic_year_id, term_code, last_value")
        .limit(1);
      return { exists: !error || !/Could not find the table/i.test(error.message), error: error?.message || null };
    })(),
    charges_legacy_cols: await (async () => {
      const cols = ["legacy_original_amount", "legacy_previously_paid_amount", "legacy_notes", "charge_source"];
      const out = {};
      for (const c of cols) {
        const { error } = await admin.from("charges").select(c).limit(1);
        out[c] = !error || !/column .* does not exist/i.test(error.message || "");
      }
      return out;
    })(),
  };

  const present = Object.entries(checks)
    .filter(([, v]) => v.exists === true || (typeof v === "object" && v.exists))
    .map(([k]) => k);
  const missing = Object.entries(checks)
    .filter(([, v]) => v.exists === false)
    .map(([k, v]) => k + ": " + (v.error || "").slice(0, 100));

  console.log(JSON.stringify({ present, missing, checks }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
