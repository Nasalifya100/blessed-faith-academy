/**
 * Remove ONLY finance verification test students and dependents.
 * Does not touch BFA-2026-* genuine pupils or opening balances.
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

function isTestStudent(s) {
  const adm = (s.admission_number || "").toUpperCase();
  const first = (s.first_name || "").toLowerCase();
  const last = (s.last_name || "").toLowerCase();
  const full = `${first} ${last}`;
  if (/^(SMOKE|POLISH|PAUD)-/.test(adm)) return true;
  if (first === "smoke" && last === "pupil") return true;
  if (full === "polish verify" || full === "polish audit") return true;
  return false;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function withRetry(label, fn, attempts = 8) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e.message || e);
      if (
        !/fetch failed|timeout|ECONNRESET|ConnectTimeout|ETIMEDOUT/i.test(msg) ||
        i === attempts - 1
      ) {
        throw e;
      }
      console.warn(`retry ${label} (${i + 1}): ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw last;
}

async function deleteIn(admin, table, column, ids, chunkSize = 50) {
  if (!ids.length) return 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await withRetry(`delete ${table} ${column}`, async () => {
      const { error, count } = await admin
        .from(table)
        .delete({ count: "exact" })
        .in(column, chunk);
      if (error) throw new Error(`${table}: ${error.message}`);
      deleted += count || 0;
    });
  }
  return deleted;
}

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: longFetch },
    },
  );

  const removed = {
    students: [],
    payments: 0,
    charges: 0,
    snapshots: 0,
    allocations: 0,
    audits: 0,
    enrolments: 0,
    guardianLinks: 0,
    guardians: 0,
    attendance: 0,
    discipline: 0,
    profileAudits: 0,
  };

  // --- Identify ---
  const students = await withRetry("list students", async () => {
    const { data, error } = await admin
      .from("students")
      .select("id, admission_number, first_name, last_name, status")
      .eq("school_id", SCHOOL_ID);
    if (error) throw new Error(error.message);
    return data || [];
  });

  const testStudents = students.filter(isTestStudent);
  const keepStudents = students.filter((s) => !isTestStudent(s));
  assert(testStudents.length > 0, "No test students found — aborting");
  assert(
    keepStudents.every((s) => /^BFA-2026-/.test(s.admission_number)),
    "Unexpected non-test student without BFA admission — aborting for safety",
  );
  // Extra safety: never delete BFA- admission numbers
  for (const s of testStudents) {
    assert(
      !/^BFA-/i.test(s.admission_number),
      `Refusing to delete BFA admission ${s.admission_number}`,
    );
  }

  const testIds = testStudents.map((s) => s.id);
  removed.students = testStudents.map((s) => ({
    id: s.id,
    admission_number: s.admission_number,
    name: `${s.first_name} ${s.last_name}`,
  }));

  console.log(
    `Identified ${testStudents.length} TEST students; retaining ${keepStudents.length} genuine students.`,
  );

  const payments = await withRetry("list test payments", async () => {
    const { data, error } = await admin
      .from("payments")
      .select("id, receipt_number, reference_number")
      .in("student_id", testIds);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const paymentIds = payments.map((p) => p.id);

  const charges = await withRetry("list test charges", async () => {
    const { data, error } = await admin
      .from("charges")
      .select("id")
      .in("student_id", testIds);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const chargeIds = charges.map((c) => c.id);

  // --- Delete dependents ---
  if (paymentIds.length) {
    removed.snapshots = await deleteIn(
      admin,
      "payment_finance_snapshots",
      "payment_id",
      paymentIds,
    );
    console.log(`Deleted snapshots: ${removed.snapshots}`);

    removed.allocations = await deleteIn(
      admin,
      "payment_allocations",
      "payment_id",
      paymentIds,
    );
    console.log(`Deleted allocations (by payment): ${removed.allocations}`);
  }

  if (chargeIds.length) {
    // Any allocations left by charge_id
    const extraAlloc = await deleteIn(
      admin,
      "payment_allocations",
      "charge_id",
      chargeIds,
    );
    removed.allocations += extraAlloc;
    if (extraAlloc) console.log(`Deleted allocations (by charge): ${extraAlloc}`);
  }

  // Audits for these students (and any orphan audits pointing at their payments/charges)
  removed.audits = await deleteIn(
    admin,
    "finance_event_audits",
    "student_id",
    testIds,
  );
  console.log(`Deleted finance_event_audits: ${removed.audits}`);

  if (paymentIds.length) {
    // leftover audits with student_id null but payment set
    await withRetry("audits by payment", async () => {
      const { error, count } = await admin
        .from("finance_event_audits")
        .delete({ count: "exact" })
        .in("payment_id", paymentIds);
      if (error) throw new Error(error.message);
      removed.audits += count || 0;
    });
  }

  removed.attendance = await deleteIn(
    admin,
    "attendance_records",
    "student_id",
    testIds,
  );
  removed.discipline = await deleteIn(
    admin,
    "discipline_incidents",
    "student_id",
    testIds,
  );

  // Profile change audits for these students if present
  try {
    removed.profileAudits = await deleteIn(
      admin,
      "student_profile_change_audits",
      "student_id",
      testIds,
    );
  } catch (e) {
    console.warn(`profile audits skip: ${e.message}`);
  }

  if (paymentIds.length) {
    removed.payments = await deleteIn(admin, "payments", "id", paymentIds);
    console.log(`Deleted payments: ${removed.payments}`);
  }

  if (chargeIds.length) {
    removed.charges = await deleteIn(admin, "charges", "id", chargeIds);
    console.log(`Deleted charges: ${removed.charges}`);
  }

  // Guardian links
  const { data: links } = await admin
    .from("student_guardians")
    .select("id, guardian_id")
    .in("student_id", testIds);
  const linkIds = (links || []).map((l) => l.id);
  const guardianIds = [...new Set((links || []).map((l) => l.guardian_id))];
  removed.guardianLinks = await deleteIn(admin, "student_guardians", "id", linkIds);
  console.log(`Deleted guardian links: ${removed.guardianLinks}`);

  // Enrolments
  removed.enrolments = await deleteIn(
    admin,
    "student_class_enrollments",
    "student_id",
    testIds,
  );
  console.log(`Deleted enrolments: ${removed.enrolments}`);

  // Orphan guardians (only linked to test students — already unlinked)
  let guardiansRemoved = 0;
  for (const gid of guardianIds) {
    const { data: remaining } = await admin
      .from("student_guardians")
      .select("id")
      .eq("guardian_id", gid)
      .limit(1);
    if ((remaining || []).length === 0) {
      // clear guardian profile audits if any
      try {
        await admin
          .from("student_profile_change_audits")
          .delete()
          .eq("guardian_id", gid);
      } catch (_) {
        /* ignore */
      }
      const { error } = await admin.from("guardians").delete().eq("id", gid);
      if (error) {
        console.warn(`guardian ${gid} not deleted: ${error.message}`);
      } else {
        guardiansRemoved += 1;
      }
    }
  }
  removed.guardians = guardiansRemoved;
  console.log(`Deleted orphan guardians: ${removed.guardians}`);

  // Students last
  const studentsDeleted = await deleteIn(admin, "students", "id", testIds);
  assert(
    studentsDeleted === testIds.length,
    `Expected to delete ${testIds.length} students, deleted ${studentsDeleted}`,
  );
  console.log(`Deleted students: ${studentsDeleted}`);

  // --- Verify ---
  const afterStudents = await withRetry("verify students", async () => {
    const { data, error } = await admin
      .from("students")
      .select("id, admission_number, first_name, last_name")
      .eq("school_id", SCHOOL_ID);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const leftoverTest = afterStudents.filter(isTestStudent);
  assert(leftoverTest.length === 0, `Leftover test students: ${leftoverTest.length}`);

  const { count: smokeAdm } = await admin
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("school_id", SCHOOL_ID)
    .or(
      "admission_number.ilike.SMOKE-%,admission_number.ilike.POLISH-%,admission_number.ilike.PAUD-%",
    );
  assert((smokeAdm || 0) === 0, `admission prefix leftovers: ${smokeAdm}`);

  const { data: leftoverRefPays } = await admin
    .from("payments")
    .select("id, receipt_number, reference_number")
    .eq("school_id", SCHOOL_ID)
    .or(
      "reference_number.ilike.%SMOKE%,reference_number.ilike.%POLISH%,reference_number.ilike.%PAUD%,notes.ilike.%Phase 3%,notes.ilike.%polish verify%,notes.ilike.%Finance polish%",
    );
  assert(
    (leftoverRefPays || []).length === 0,
    `leftover test payments: ${JSON.stringify(leftoverRefPays)}`,
  );

  // Orphan allocations / snapshots
  const { data: allAlloc } = await admin
    .from("payment_allocations")
    .select("id, payment_id, charge_id")
    .limit(2000);
  const schoolPaymentIds = new Set();
  const { data: schoolPays } = await admin
    .from("payments")
    .select("id")
    .eq("school_id", SCHOOL_ID);
  for (const p of schoolPays || []) schoolPaymentIds.add(p.id);
  const orphanAlloc = (allAlloc || []).filter(
    (a) => !schoolPaymentIds.has(a.payment_id),
  );
  // Filter to school by joining is hard; check allocations whose payment missing entirely
  let orphanAllocCount = 0;
  for (const a of allAlloc || []) {
    const { data: p } = await admin
      .from("payments")
      .select("id")
      .eq("id", a.payment_id)
      .maybeSingle();
    if (!p) orphanAllocCount += 1;
  }
  assert(orphanAllocCount === 0, `orphan allocations: ${orphanAllocCount}`);

  const { data: snaps } = await admin
    .from("payment_finance_snapshots")
    .select("payment_id")
    .eq("school_id", SCHOOL_ID);
  let orphanSnaps = 0;
  for (const s of snaps || []) {
    const { data: p } = await admin
      .from("payments")
      .select("id")
      .eq("id", s.payment_id)
      .maybeSingle();
    if (!p) orphanSnaps += 1;
  }
  assert(orphanSnaps === 0, `orphan snapshots: ${orphanSnaps}`);

  // Finance counts remaining
  const { count: payCount } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("school_id", SCHOOL_ID);
  const { count: chargeCount } = await admin
    .from("charges")
    .select("id", { count: "exact", head: true })
    .eq("school_id", SCHOOL_ID);
  const { count: allocCount } = await admin
    .from("payment_allocations")
    .select("id", { count: "exact", head: true });
  const { count: snapCount } = await admin
    .from("payment_finance_snapshots")
    .select("payment_id", { count: "exact", head: true })
    .eq("school_id", SCHOOL_ID);
  const { count: auditCount } = await admin
    .from("finance_event_audits")
    .select("id", { count: "exact", head: true })
    .eq("school_id", SCHOOL_ID);

  // Reconciliation: for each remaining completed payment, allocated <= amount
  const { data: completedPays } = await admin
    .from("payments")
    .select("id, amount, status, student_id")
    .eq("school_id", SCHOOL_ID)
    .eq("status", "completed");
  let overAlloc = 0;
  for (const p of completedPays || []) {
    const { data: rows } = await admin
      .from("payment_allocations")
      .select("amount")
      .eq("payment_id", p.id)
      .is("reversed_at", null);
    const sum = (rows || []).reduce((a, r) => a + Number(r.amount), 0);
    if (sum > Number(p.amount) + 0.001) overAlloc += 1;
  }

  // Sample genuine student still present
  const sample = keepStudents[0];
  const stillThere = afterStudents.find((s) => s.id === sample.id);
  assert(stillThere, "Genuine student missing after cleanup!");

  const report = {
    verdict: "TEST DATA CLEANUP COMPLETE",
    removed,
    retained: {
      studentCount: afterStudents.length,
      sampleGenuine: {
        admission_number: stillThere.admission_number,
        name: `${stillThere.first_name} ${stillThere.last_name}`,
      },
      payments: payCount || 0,
      charges: chargeCount || 0,
      allocationsApprox: allocCount || 0,
      snapshots: snapCount || 0,
      financeAudits: auditCount || 0,
    },
    reconciliation: {
      overAllocatedCompletedPayments: overAlloc,
      orphanAllocations: orphanAllocCount,
      orphanSnapshots: orphanSnaps,
      leftoverTestStudents: leftoverTest.length,
      leftoverTestPayments: (leftoverRefPays || []).length,
    },
  };

  console.log("\nCLEANUP_REPORT");
  console.log(JSON.stringify(report, null, 2));
  assert(overAlloc === 0, "reconciliation failed: over-allocated payments");
  console.log("\nTEST DATA CLEANUP COMPLETE");
}

main().catch((e) => {
  console.error("\nTEST DATA CLEANUP BLOCKED");
  console.error(e.message || e);
  process.exit(1);
});
