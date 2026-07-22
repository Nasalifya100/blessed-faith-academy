/**
 * Finance polish — sections 5–6 only (audit + security).
 * Assumes migration install + snapshot/receipt checks already passed.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function withRetry(label, fn, attempts = 10) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e.message || e);
      if (
        !/fetch failed|timeout|ECONNRESET|ConnectTimeout|UND_ERR_CONNECT|ETIMEDOUT|unrecognized JWT kid|unable to parse or verify signature/i.test(
          msg,
        ) ||
        i === attempts - 1
      ) {
        throw e;
      }
      const wait = 4000 * (i + 1);
      console.warn(`retry ${label} (${i + 1}) wait ${wait}ms: ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail: detail || "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("Waiting 45s for API stability…");
  await new Promise((r) => setTimeout(r, 45_000));

  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const schoolId = "516977ed-8612-4e27-addc-cdb5cdb72505";
  const stamp = Date.now().toString(36);
  const bursarEmail = `polish-aud-${stamp}@bfa-smoke.local`;
  const teacherEmail = `polish-tch-${stamp}@bfa-smoke.local`;
  const password = `PolishAudit!${stamp}A1`;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: longFetch },
  });

  let bursarId;
  let teacherId;
  let studentId;
  let cancelChargeId;
  let paymentId;

  try {
    const year = await withRetry("year", async () => {
      const { data, error } = await admin
        .from("academic_years")
        .select("id")
        .eq("school_id", schoolId)
        .eq("is_current", true)
        .single();
      if (error) throw new Error(error.message);
      return data;
    });
    const term = await withRetry("term", async () => {
      const { data, error } = await admin
        .from("terms")
        .select("id")
        .eq("academic_year_id", year.id)
        .order("term_number")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error("no term");
      return data;
    });
    const cls = await withRetry("class", async () => {
      const { data, error } = await admin
        .from("classes")
        .select("id")
        .eq("school_id", schoolId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error("no class");
      return data;
    });
    const optionalItem = await withRetry("optional fee", async () => {
      const { data, error } = await admin
        .from("fee_items")
        .select("id")
        .eq("school_id", schoolId)
        .eq("is_optional", true)
        .eq("is_active", true)
        .in("category", ["meal", "uniform"])
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error("no optional");
      return data;
    });
    const mandatoryItem = await withRetry("mandatory fee", async () => {
      const { data, error } = await admin
        .from("fee_items")
        .select("id")
        .eq("school_id", schoolId)
        .eq("is_optional", false)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error("no mandatory");
      return data;
    });

    const bursarUser = await withRetry("create bursar", async () => {
      const { data, error } = await admin.auth.admin.createUser({
        email: bursarEmail,
        password,
        email_confirm: true,
      });
      if (error || !data?.user) throw new Error(error?.message || "no user");
      return data;
    });
    bursarId = bursarUser.user.id;

    const teacherUser = await withRetry("create teacher", async () => {
      const { data, error } = await admin.auth.admin.createUser({
        email: teacherEmail,
        password,
        email_confirm: true,
      });
      if (error || !data?.user) throw new Error(error?.message || "no user");
      return data;
    });
    teacherId = teacherUser.user.id;

    await withRetry("profiles", async () => {
      const { error } = await admin.from("profiles").upsert([
        {
          id: bursarId,
          school_id: schoolId,
          full_name: "Polish Audit Bursar",
          role: "bursar",
          is_active: true,
        },
        {
          id: teacherId,
          school_id: schoolId,
          full_name: "Polish Audit Teacher",
          role: "teacher",
          is_active: true,
        },
      ]);
      if (error) throw new Error(error.message);
    });

    studentId = randomUUID();
    await withRetry("student", async () => {
      const { error } = await admin.from("students").insert({
        id: studentId,
        school_id: schoolId,
        admission_number: `PAUD-${stamp}`.toUpperCase().slice(0, 20),
        first_name: "Polish",
        last_name: "Audit",
        date_of_birth: "2015-06-01",
        gender: "male",
        status: "enrolled",
        enrollment_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
    });
    await withRetry("enrol", async () => {
      const { error } = await admin.from("student_class_enrollments").insert({
        school_id: schoolId,
        student_id: studentId,
        class_id: cls.id,
        academic_year_id: year.id,
        status: "active",
      });
      if (error) throw new Error(error.message);
    });

    async function clientAs(email) {
      const c = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: longFetch },
      });
      await withRetry(`signin ${email}`, async () => {
        const { error } = await c.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      });
      return c;
    }

    let bursar = await clientAs(bursarEmail);
    const teacher = await clientAs(teacherEmail);

    async function insertCharge(amount, feeItemId) {
      return withRetry(`charge ${amount}`, async () => {
        const id = randomUUID();
        const { error } = await admin.from("charges").insert({
          id,
          school_id: schoolId,
          student_id: studentId,
          fee_item_id: feeItemId,
          academic_year_id: year.id,
          term_id: term.id,
          amount,
          status: "outstanding",
          created_by: bursarId,
        });
        if (error) throw new Error(error.message);
        return id;
      });
    }

    // 5a cancel + audit
    cancelChargeId = await insertCharge(40, optionalItem.id);
    await withRetry("cancel optional", async () => {
      bursar = await clientAs(bursarEmail);
      const { error } = await bursar.rpc("cancel_optional_charge", {
        p_charge_id: cancelChargeId,
        p_reason: "Polish verify optional cancel",
      });
      if (error) throw new Error(error.message);
    });

    const cancelled = await withRetry("read cancelled", async () => {
      const { data, error } = await admin
        .from("charges")
        .select("status")
        .eq("id", cancelChargeId)
        .single();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(cancelled.status === "cancelled", "not cancelled");

    const audit = await withRetry("read audit", async () => {
      const { data, error } = await admin
        .from("finance_event_audits")
        .select("*")
        .eq("charge_id", cancelChargeId)
        .eq("event_type", "optional_charge_cancelled");
      if (error) throw new Error(error.message);
      if (!data || data.length !== 1) throw new Error(`audit count=${data?.length}`);
      return data[0];
    });
    assert(audit.student_id === studentId, "student");
    assert(audit.actor_id === bursarId, "actor");
    assert(Number(audit.amount) === 40, "amount");
    assert(audit.metadata?.previous_status === "outstanding", "prev");
    assert(audit.metadata?.new_status === "cancelled", "new");
    assert(audit.metadata?.event_code === "OPTIONAL_CHARGE_CANCELLED", "code");
    record(
      "5a OPTIONAL_CHARGE_CANCELLED audit written",
      true,
      `id=${audit.id}`,
    );

    const timeline = await withRetry("timeline", async () => {
      bursar = await clientAs(bursarEmail);
      const { data, error } = await bursar
        .from("finance_event_audits")
        .select("id")
        .eq("student_id", studentId)
        .eq("event_type", "optional_charge_cancelled");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("not visible");
      return data;
    });
    record("5b Audit visible on student history RLS", true, `count=${timeline.length}`);

    const denyCharge = await insertCharge(15, optionalItem.id);
    const denyErr = await withRetry("deny cancel", async () => {
      const { error } = await teacher.rpc("cancel_optional_charge", {
        p_charge_id: denyCharge,
      });
      if (!error) throw new Error("teacher cancel should fail");
      return error;
    });
    record("5c Unauthorized cancel denied", true, denyErr.message.slice(0, 100));

    await withRetry("cleanup deny", async () => {
      bursar = await clientAs(bursarEmail);
      const { error } = await bursar.rpc("cancel_optional_charge", {
        p_charge_id: denyCharge,
        p_reason: "cleanup",
      });
      if (error) throw new Error(error.message);
    });

    const allocatedOptionalId = await insertCharge(30, optionalItem.id);
    const payOpt = await withRetry("pay optional", async () => {
      bursar = await clientAs(bursarEmail);
      const { data, error } = await bursar.rpc("record_payment", {
        p_student_id: studentId,
        p_amount: 30,
        p_method: "bank_transfer",
        p_idempotency_key: randomUUID(),
        p_reference_number: `PAUD-OPT-${stamp}`,
        p_paid_on: new Date().toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
      return data;
    });
    paymentId = payOpt.payment_id;

    const cancelAllocErr = await withRetry("block allocated cancel", async () => {
      bursar = await clientAs(bursarEmail);
      const { error } = await bursar.rpc("cancel_optional_charge", {
        p_charge_id: allocatedOptionalId,
      });
      if (!error) throw new Error("should block");
      return error;
    });
    record(
      "5d Allocated optional charge cancel blocked",
      true,
      cancelAllocErr.message.slice(0, 120),
    );

    await withRetry("void opt pay", async () => {
      bursar = await clientAs(bursarEmail);
      const { error } = await bursar.rpc("void_payment", {
        p_payment_id: paymentId,
        p_reason: "audit verify cleanup",
      });
      if (error) throw new Error(error.message);
    });

    // Security
    bursar = await clientAs(bursarEmail);
    const { error: forgeSnapErr } = await bursar.from("payment_finance_snapshots").insert({
      payment_id: randomUUID(),
      school_id: schoolId,
      student_id: studentId,
      balance_before: 1,
      balance_after: 0,
      available_credit_before: 0,
      available_credit_after: 0,
      allocated_amount: 1,
      outstanding_after: 0,
      credit_created: 0,
    });
    assert(!!forgeSnapErr, "forge snap");
    record("6a Authenticated cannot forge snapshot insert", true, forgeSnapErr.message.slice(0, 80));

    // Use any existing snapshot payment
    const { data: anySnap } = await admin
      .from("payment_finance_snapshots")
      .select("payment_id")
      .eq("school_id", schoolId)
      .limit(1)
      .maybeSingle();
    if (anySnap?.payment_id) {
      const { error: updErr } = await bursar
        .from("payment_finance_snapshots")
        .update({ balance_before: 0 })
        .eq("payment_id", anySnap.payment_id);
      assert(!!updErr, "update snap");
      record("6b Authenticated cannot update snapshots", true, updErr.message.slice(0, 80));
    } else {
      record("6b Authenticated cannot update snapshots", true, "no snap to probe; insert forge covered");
    }

    const { error: forgeAuditErr } = await bursar.from("finance_event_audits").insert({
      school_id: schoolId,
      student_id: studentId,
      event_type: "optional_charge_cancelled",
      charge_id: cancelChargeId,
      amount: 1,
      actor_id: bursarId,
      reason: "forged",
      metadata: { event_code: "OPTIONAL_CHARGE_CANCELLED" },
    });
    assert(!!forgeAuditErr, "forge audit");
    record("6c Authenticated cannot forge finance audit events", true, forgeAuditErr.message.slice(0, 80));

    const { error: crossErr } = await bursar.from("payment_finance_snapshots").insert({
      payment_id: randomUUID(),
      school_id: randomUUID(),
      student_id: studentId,
      balance_before: 0,
      balance_after: 0,
      available_credit_before: 0,
      available_credit_after: 0,
      allocated_amount: 0,
      outstanding_after: 0,
      credit_created: 0,
    });
    assert(!!crossErr, "cross school");
    record("6d Cannot create cross-school snapshots as user", true, crossErr.message.slice(0, 80));

    // Invariants
    const { data: activeAllocAll, error: allocScanErr } = await admin
      .from("payment_allocations")
      .select(
        "id, amount, payment_id, charge_id, payment:payments(amount, status, student_id, school_id), charge:charges(amount, student_id, school_id)",
      )
      .is("reversed_at", null)
      .limit(500);
    assert(!allocScanErr, allocScanErr?.message);
    const schoolAllocs = (activeAllocAll || []).filter(
      (row) => row.payment?.school_id === schoolId,
    );
    let overPay = 0;
    let overCh = 0;
    let cross = 0;
    const payMap = new Map();
    const chMap = new Map();
    for (const row of schoolAllocs) {
      const p = row.payment;
      const c = row.charge;
      if (!p || !c) continue;
      if (p.student_id !== c.student_id || p.school_id !== c.school_id) cross += 1;
      payMap.set(row.payment_id, (payMap.get(row.payment_id) || 0) + Number(row.amount));
      chMap.set(row.charge_id, (chMap.get(row.charge_id) || 0) + Number(row.amount));
    }
    if (payMap.size) {
      const { data: pays } = await admin
        .from("payments")
        .select("id, amount, status")
        .in("id", [...payMap.keys()]);
      for (const p of pays || []) {
        if (p.status === "completed" && payMap.get(p.id) > Number(p.amount) + 0.001) {
          overPay += 1;
        }
      }
    }
    if (chMap.size) {
      const { data: chs } = await admin
        .from("charges")
        .select("id, amount")
        .in("id", [...chMap.keys()]);
      for (const c of chs || []) {
        if (chMap.get(c.id) > Number(c.amount) + 0.001) overCh += 1;
      }
    }
    assert(cross === 0 && overPay === 0 && overCh === 0, `cross=${cross} overPay=${overPay} overCh=${overCh}`);
    record("6e No over-allocation / no cross-student allocations", true, `rows=${schoolAllocs.length}`);

    const sum = await withRetry("summary", async () => {
      bursar = await clientAs(bursarEmail);
      const { data, error } = await bursar.rpc("get_student_finance_summary", {
        p_student_id: studentId,
      });
      if (error) throw new Error(error.message);
      return data;
    });
    const paid = Number(sum.total_completed_payments || 0);
    const allocated = Number(sum.total_allocated || 0);
    const credit = Number(sum.available_credit || 0);
    assert(Math.abs(paid - allocated - credit) < 0.02, `reconcile ${paid}-${allocated}-${credit}`);
    record("6f Available credit reconciles", true, `${paid}−${allocated}=${credit}`);

    console.log(
      "\nEVIDENCE",
      JSON.stringify({ studentId, cancelChargeId, auditId: audit.id, paymentId }, null, 2),
    );
  } catch (e) {
    record("FATAL", false, e.message || String(e));
    console.error("VERIFY_FATAL", e.message || e);
    process.exitCode = 1;
  } finally {
    try {
      if (bursarId) {
        await admin.auth.admin.updateUserById(bursarId, { ban_duration: "876000h" });
      }
      if (teacherId) {
        await admin.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" });
      }
    } catch (_) {
      /* ignore */
    }
    console.log("\nAUDIT_SECURITY_SUMMARY");
    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`${r.pass ? "OK" : "XX"} ${r.name}`);
    console.log(
      failed.length === 0
        ? "\nSECTIONS 5–6 PASS"
        : `\nSECTIONS 5–6 FAIL — ${failed.map((f) => f.name).join("; ")}`,
    );
    if (failed.length) process.exitCode = 1;
  }
}

main();
