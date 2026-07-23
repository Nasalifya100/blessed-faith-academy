/**
 * Inventory finance verification test data (read-only).
 * Does not delete.
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

const SCHOOL_ID = "516977ed-8612-4e27-addc-cdb5cdb72505";

function isTestStudent(s) {
  const adm = (s.admission_number || "").toUpperCase();
  const first = (s.first_name || "").toLowerCase();
  const last = (s.last_name || "").toLowerCase();
  const full = `${first} ${last}`;

  if (/^(SMOKE|POLISH|PAUD)-/.test(adm)) return true;
  if (first === "smoke" || last === "pupil") return true;
  if (full.includes("polish verify") || full.includes("polish audit")) return true;
  if (full.includes("smoke") && (full.includes("test") || full.includes("pupil")))
    return true;
  if (full.includes("finance verify") || full.includes("verification")) return true;
  if (first === "demo" || first === "dummy") return true;
  return false;
}

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: students, error } = await admin
    .from("students")
    .select(
      "id, admission_number, first_name, last_name, status, created_at, school_id",
    )
    .eq("school_id", SCHOOL_ID)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const testStudents = (students || []).filter(isTestStudent);
  const keepStudents = (students || []).filter((s) => !isTestStudent(s));

  console.log("=== ALL STUDENTS ===");
  for (const s of students || []) {
    const tag = isTestStudent(s) ? "TEST" : "KEEP";
    console.log(
      `${tag} ${s.admission_number} | ${s.first_name} ${s.last_name} | ${s.status} | ${s.id}`,
    );
  }

  const testIds = testStudents.map((s) => s.id);
  const inventory = {
    schoolId: SCHOOL_ID,
    totalStudents: (students || []).length,
    testStudents: testStudents.length,
    keepStudents: keepStudents.length,
    testStudentRows: testStudents,
    payments: [],
    charges: [],
    snapshots: 0,
    allocations: 0,
    audits: 0,
    guardians: [],
    enrolments: 0,
    attendance: 0,
    discipline: 0,
  };

  if (testIds.length === 0) {
    console.log("\nNo test students matched.");
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  const { data: payments } = await admin
    .from("payments")
    .select(
      "id, receipt_number, amount, status, reference_number, notes, student_id, paid_on",
    )
    .in("student_id", testIds);
  inventory.payments = payments || [];

  const { data: charges } = await admin
    .from("charges")
    .select("id, amount, status, description, student_id, created_at")
    .in("student_id", testIds);
  inventory.charges = charges || [];

  const paymentIds = (payments || []).map((p) => p.id);
  if (paymentIds.length) {
    const { count: snapCount } = await admin
      .from("payment_finance_snapshots")
      .select("payment_id", { count: "exact", head: true })
      .in("payment_id", paymentIds);
    inventory.snapshots = snapCount || 0;

    const { count: allocCount } = await admin
      .from("payment_allocations")
      .select("id", { count: "exact", head: true })
      .in("payment_id", paymentIds);
    inventory.allocations = allocCount || 0;
  }

  const { count: auditCount } = await admin
    .from("finance_event_audits")
    .select("id", { count: "exact", head: true })
    .in("student_id", testIds);
  inventory.audits = auditCount || 0;

  const { count: enrCount } = await admin
    .from("student_class_enrollments")
    .select("id", { count: "exact", head: true })
    .in("student_id", testIds);
  inventory.enrolments = enrCount || 0;

  const { count: attCount } = await admin
    .from("attendance_records")
    .select("id", { count: "exact", head: true })
    .in("student_id", testIds);
  inventory.attendance = attCount || 0;

  const { count: discCount } = await admin
    .from("discipline_incidents")
    .select("id", { count: "exact", head: true })
    .in("student_id", testIds);
  inventory.discipline = discCount || 0;

  const { data: links } = await admin
    .from("student_guardians")
    .select("id, guardian_id, student_id")
    .in("student_id", testIds);
  const guardianIds = [...new Set((links || []).map((l) => l.guardian_id))];
  const orphanGuardians = [];
  for (const gid of guardianIds) {
    const { data: otherLinks } = await admin
      .from("student_guardians")
      .select("id, student_id")
      .eq("guardian_id", gid);
    const linkedToNonTest = (otherLinks || []).some(
      (l) => !testIds.includes(l.student_id),
    );
    if (!linkedToNonTest) orphanGuardians.push(gid);
  }
  inventory.guardianLinks = links || [];
  inventory.orphanGuardianIds = orphanGuardians;

  // Also scan payments with smoke/polish references on KEEP students (should be none)
  const { data: refPays } = await admin
    .from("payments")
    .select("id, receipt_number, reference_number, notes, student_id")
    .eq("school_id", SCHOOL_ID)
    .or(
      "reference_number.ilike.%SMOKE%,reference_number.ilike.%POLISH%,reference_number.ilike.%PAUD%,notes.ilike.%smoke%,notes.ilike.%polish verify%,notes.ilike.%Phase 3%",
    );

  inventory.paymentsMatchedByRef = refPays || [];

  console.log("\n=== INVENTORY SUMMARY ===");
  console.log(JSON.stringify(inventory, null, 2));
}

main().catch((e) => {
  console.error("INVENTORY_FATAL", e.message || e);
  process.exit(1);
});
