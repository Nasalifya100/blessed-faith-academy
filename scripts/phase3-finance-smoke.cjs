/**
 * Phase 3.2 controlled finance smoke tests (pre-production only).
 * Creates disposable auth users + labeled pupil, exercises RPCs, cleans up.
 * Does not deploy, activate, or backfill.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

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

async function withRetry(label, fn, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e.message || e);
      if (
        !/fetch failed|timeout|ECONNRESET|ConnectTimeout/i.test(msg) ||
        i === attempts - 1
      ) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      console.warn(`retry ${label} (${i + 1}): ${msg.slice(0, 80)}`);
    }
  }
  throw last;
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert(url && serviceKey && anonKey, "Missing Supabase env");

  const host = new URL(url).hostname;
  const ref = host.split(".")[0];
  console.log(JSON.stringify({ project_ref: ref, host }, null, 2));

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const schoolId = "516977ed-8612-4e27-addc-cdb5cdb72505";
  const stamp = Date.now().toString(36);
  const bursarEmail = `smoke-bursar-${stamp}@bfa-smoke.local`;
  const teacherEmail = `smoke-teacher-${stamp}@bfa-smoke.local`;
  const password = `SmokeTest!${stamp}A1`;

  let bursarId;
  let teacherId;
  let studentId;
  let paymentExactId;
  let paymentAdvanceId;
  const createdChargeIds = [];

  try {
    const gates = await withRetry("read gates", async () => {
      const { data, error } = await admin
        .from("finance_allocation_gates")
        .select("activated_at, backfill_completed_at")
        .eq("school_id", schoolId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(gates?.activated_at, "Expected ALLOCATION_ENABLED (activated_at set)");
    record("Gate: allocation still active", true, String(gates.activated_at));

    // --- Context ---
    const year = await withRetry("read year", async () => {
      const { data, error } = await admin
        .from("academic_years")
        .select("id")
        .eq("school_id", schoolId)
        .eq("is_current", true)
        .single();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(year?.id, "No current academic year");

    const anyTerm = await withRetry("read term", async () => {
      const { data: term } = await admin
        .from("terms")
        .select("id")
        .eq("academic_year_id", year.id)
        .eq("is_current", true)
        .maybeSingle();
      if (term?.id) return term;
      const { data, error } = await admin
        .from("terms")
        .select("id")
        .eq("academic_year_id", year.id)
        .order("term_number")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(anyTerm?.id, "No term found");

    const cls = await withRetry("read class", async () => {
      const { data, error } = await admin
        .from("classes")
        .select("id")
        .eq("school_id", schoolId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(cls?.id, "No class found");

    const optionalItem = await withRetry("read optional fee", async () => {
      const { data, error } = await admin
        .from("fee_items")
        .select("id, name, category")
        .eq("school_id", schoolId)
        .eq("is_optional", true)
        .eq("is_active", true)
        .in("category", ["meal", "uniform"])
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(optionalItem?.id, "No optional meal/uniform fee item");

    const mandatoryItem = await withRetry("read mandatory fee", async () => {
      const { data, error } = await admin
        .from("fee_items")
        .select("id, name")
        .eq("school_id", schoolId)
        .eq("is_optional", false)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    });
    assert(mandatoryItem?.id, "No mandatory fee item");

    // --- Disposable actors ---
    const { data: bursarUser, error: bCreateErr } =
      await admin.auth.admin.createUser({
        email: bursarEmail,
        password,
        email_confirm: true,
      });
    assert(!bCreateErr && bursarUser.user, `bursar create: ${bCreateErr?.message}`);
    bursarId = bursarUser.user.id;

    const { data: teacherUser, error: tCreateErr } =
      await admin.auth.admin.createUser({
        email: teacherEmail,
        password,
        email_confirm: true,
      });
    assert(!tCreateErr && teacherUser.user, `teacher create: ${tCreateErr?.message}`);
    teacherId = teacherUser.user.id;

    const { error: profErr } = await admin.from("profiles").upsert([
      {
        id: bursarId,
        school_id: schoolId,
        full_name: "Smoke Test Bursar",
        role: "bursar",
        is_active: true,
      },
      {
        id: teacherId,
        school_id: schoolId,
        full_name: "Smoke Test Teacher",
        role: "teacher",
        is_active: true,
      },
    ]);
    assert(!profErr, `profiles: ${profErr?.message}`);

    // --- Disposable student ---
    studentId = randomUUID();
    const admission = `SMOKE-${stamp}`.toUpperCase().slice(0, 20);
    const { error: stErr } = await admin.from("students").insert({
      id: studentId,
      school_id: schoolId,
      admission_number: admission,
      first_name: "Smoke",
      last_name: "Pupil",
      date_of_birth: "2015-06-01",
      gender: "female",
      status: "enrolled",
      enrollment_date: new Date().toISOString().slice(0, 10),
    });
    assert(!stErr, `student insert: ${stErr?.message}`);

    const { error: enErr } = await admin.from("student_class_enrollments").insert({
      school_id: schoolId,
      student_id: studentId,
      class_id: cls.id,
      academic_year_id: year.id,
      status: "active",
    });
    assert(!enErr, `enrolment: ${enErr?.message}`);

    async function clientAs(email) {
      const c = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await c.auth.signInWithPassword({ email, password });
      assert(!error, `signIn ${email}: ${error?.message}`);
      return c;
    }

    const bursar = await clientAs(bursarEmail);
    const teacher = await clientAs(teacherEmail);

    async function insertCharge(amount, feeItemId) {
      return withRetry(`insert charge ${amount}`, async () => {
        const id = randomUUID();
        const { error } = await admin.from("charges").insert({
          id,
          school_id: schoolId,
          student_id: studentId,
          fee_item_id: feeItemId,
          academic_year_id: year.id,
          term_id: anyTerm.id,
          amount,
          status: "outstanding",
          created_by: bursarId,
        });
        if (error) throw new Error(error.message);
        createdChargeIds.push(id);
        return id;
      });
    }

    async function summary() {
      const { data, error } = await bursar.rpc("get_student_finance_summary", {
        p_student_id: studentId,
      });
      assert(!error, `summary: ${error?.message}`);
      return data;
    }

    // ========== TEST 1 — Optional cancel ==========
    const optChargeId = await insertCharge(50, optionalItem.id);
    const { error: cancelOkErr } = await bursar.rpc("cancel_optional_charge", {
      p_charge_id: optChargeId,
    });
    assert(!cancelOkErr, `cancel authorized: ${cancelOkErr?.message}`);

    const { data: cancelledRow } = await admin
      .from("charges")
      .select("status")
      .eq("id", optChargeId)
      .single();
    assert(cancelledRow?.status === "cancelled", "optional charge status not cancelled");
    record("TEST 1a: authorized cancel optional charge", true, "status=cancelled");

    const optCharge2 = await insertCharge(50, optionalItem.id);
    const { error: cancelDenyErr } = await teacher.rpc("cancel_optional_charge", {
      p_charge_id: optCharge2,
    });
    assert(!!cancelDenyErr, "teacher should be denied cancel");
    record(
      "TEST 1b: unauthorized cancel denied",
      true,
      cancelDenyErr.message.slice(0, 120),
    );

    const { data: cancelAudits, error: cancelAuditErr } = await admin
      .from("finance_event_audits")
      .select("id, event_type, amount, reason, metadata, actor_id")
      .eq("charge_id", optChargeId)
      .eq("event_type", "optional_charge_cancelled");
    assert(!cancelAuditErr, `cancel audit query: ${cancelAuditErr?.message}`);
    assert(
      (cancelAudits || []).length === 1,
      `expected 1 optional_charge_cancelled audit, got ${(cancelAudits || []).length}`,
    );
    const cancelAudit = cancelAudits[0];
    assert(
      cancelAudit?.metadata?.event_code === "OPTIONAL_CHARGE_CANCELLED",
      "cancel audit missing OPTIONAL_CHARGE_CANCELLED event_code",
    );
    record(
      "TEST 1c: cancel audit trail",
      true,
      `optional_charge_cancelled logged; previous→new=${cancelAudit?.metadata?.previous_status}→${cancelAudit?.metadata?.new_status}`,
    );

    // Clear the optional charge used for the deny test so FIFO payments
    // only hit intentional mandatory charges below.
    const { error: cleanupOptErr } = await bursar.rpc("cancel_optional_charge", {
      p_charge_id: optCharge2,
    });
    assert(!cleanupOptErr, `cleanup optional: ${cleanupOptErr?.message}`);
    record("TEST 1d: cleanup unpaid optional before payment tests", true);

    // ========== TEST 2 — Exact payment ==========
    const chargeMain = await insertCharge(100, mandatoryItem.id);
    const keyExact = randomUUID();
    const payExact = await withRetry("record_payment exact", async () => {
      const { data, error } = await bursar.rpc("record_payment", {
        p_student_id: studentId,
        p_amount: 100,
        p_method: "mobile_money",
        p_idempotency_key: keyExact,
        p_reference_number: `SMOKE-EXACT-${stamp}`,
        p_paid_on: new Date().toISOString().slice(0, 10),
        p_notes: "Phase 3.2 smoke exact",
      });
      if (error) throw new Error(error.message);
      return data;
    });
    paymentExactId = payExact?.payment_id;
    assert(paymentExactId, "exact payment_id missing");
    assert(
      Number(payExact.amount_allocated) === 100,
      `rpc allocated=${payExact.amount_allocated}`,
    );
    assert(Number(payExact.credit_created) === 0, `credit=${payExact.credit_created}`);

    const { count: allocExact } = await admin
      .from("payment_allocations")
      .select("id", { count: "exact", head: true })
      .eq("payment_id", paymentExactId)
      .is("reversed_at", null);
    assert(allocExact >= 1, "expected allocation row(s)");

    const { data: allocOnMain } = await admin
      .from("payment_allocations")
      .select("amount")
      .eq("charge_id", chargeMain)
      .is("reversed_at", null);
    const allocatedToMain = (allocOnMain || []).reduce(
      (a, r) => a + Number(r.amount),
      0,
    );
    assert(
      allocatedToMain === 100,
      `main charge alloc=${allocatedToMain} (payment rpc allocated=${payExact.amount_allocated})`,
    );

    const { data: snapExact } = await admin
      .from("payment_finance_snapshots")
      .select(
        "balance_before, balance_after, allocated_amount, outstanding_after, available_credit_before, available_credit_after",
      )
      .eq("payment_id", paymentExactId)
      .maybeSingle();
    assert(snapExact, "payment_finance_snapshots row missing for exact payment");
    assert(
      Number(snapExact.allocated_amount) === 100,
      `snapshot allocated=${snapExact.allocated_amount}`,
    );

    record(
      "TEST 2: exact payment + allocation",
      true,
      `payment=${paymentExactId} allocated=100 credit=0 receipt=${payExact.receipt_number}; snapshot bal ${snapExact.balance_before}→${snapExact.balance_after}`,
    );

    // Free the main charge for the advance test (unique active charge constraint).
    await withRetry("void exact before advance", async () => {
      const { error } = await bursar.rpc("void_payment", {
        p_payment_id: paymentExactId,
        p_reason: "Phase 3.2 reopen charge for advance test",
      });
      if (error) throw new Error(error.message);
    });
    paymentExactId = null;

    // ========== TEST 3 — Advance payment (same unpaid charge) ==========
    const keyAdv = randomUUID();
    const payAdv = await withRetry("record_payment advance", async () => {
      const { data, error } = await bursar.rpc("record_payment", {
        p_student_id: studentId,
        p_amount: 150,
        p_method: "bank_transfer",
        p_idempotency_key: keyAdv,
        p_reference_number: `SMOKE-ADV-${stamp}`,
        p_paid_on: new Date().toISOString().slice(0, 10),
        p_notes: "Phase 3.2 smoke advance",
      });
      if (error) throw new Error(error.message);
      return data;
    });
    paymentAdvanceId = payAdv?.payment_id;
    assert(Number(payAdv.amount_allocated) === 100, `adv alloc=${payAdv.amount_allocated}`);
    assert(Number(payAdv.credit_created) === 50, `adv credit=${payAdv.credit_created}`);

    const sumAdv = await withRetry("summary after advance", summary);
    assert(Number(sumAdv.available_credit) >= 50, `credit after adv=${sumAdv.available_credit}`);
    record(
      "TEST 3: advance payment creates credit",
      true,
      `allocated=100 credit_created=50 available_credit=${sumAdv.available_credit} receipt=${payAdv.receipt_number}`,
    );

    // ========== TEST 4 — Apply credit onto a separate optional charge ==========
    const chargeCredit = await insertCharge(80, optionalItem.id);
    const beforeApply = await withRetry("summary before apply", summary);
    const creditBefore = Number(beforeApply.available_credit);
    const outstandingBefore = Number(beforeApply.outstanding_balance);

    const applyRes = await withRetry("apply_available_credit", async () => {
      const { data, error } = await bursar.rpc("apply_available_credit", {
        p_student_id: studentId,
      });
      if (error) throw new Error(error.message);
      return data;
    });
    const applied = Number(applyRes?.credit_applied ?? applyRes?.amount_applied ?? 0);
    const afterApply = await withRetry("summary after apply", summary);
    const creditAfter = Number(afterApply.available_credit);
    const outstandingAfter = Number(afterApply.outstanding_balance);
    assert(creditAfter < creditBefore || applied > 0, "credit should decrease");
    assert(
      outstandingAfter <= outstandingBefore,
      `outstanding ${outstandingBefore} -> ${outstandingAfter}`,
    );

    const { data: creditAudits } = await admin
      .from("finance_event_audits")
      .select("id, event_type")
      .eq("student_id", studentId)
      .eq("event_type", "credit_applied")
      .limit(5);
    record(
      "TEST 4: apply credit",
      true,
      `credit ${creditBefore}->${creditAfter}; outstanding ${outstandingBefore}->${outstandingAfter}; audits=${(creditAudits || []).length}`,
    );

    // ========== TEST 5 — Void advance payment ==========
    await withRetry("void advance", async () => {
      const { error } = await bursar.rpc("void_payment", {
        p_payment_id: paymentAdvanceId,
        p_reason: "Phase 3.2 smoke void",
      });
      if (error) throw new Error(error.message);
    });

    const { data: voidedPay } = await admin
      .from("payments")
      .select("status, receipt_number")
      .eq("id", paymentAdvanceId)
      .single();
    assert(voidedPay?.status === "voided", `status=${voidedPay?.status}`);
    assert(voidedPay?.receipt_number, "receipt number lost after void");

    const { count: activeFromAdv } = await admin
      .from("payment_allocations")
      .select("id", { count: "exact", head: true })
      .eq("payment_id", paymentAdvanceId)
      .is("reversed_at", null);
    assert(activeFromAdv === 0, `orphan active allocs=${activeFromAdv}`);

    const { count: reversedFromAdv } = await admin
      .from("payment_allocations")
      .select("id", { count: "exact", head: true })
      .eq("payment_id", paymentAdvanceId)
      .not("reversed_at", "is", null);
    assert(reversedFromAdv >= 1, "expected reversed allocation rows");

    record(
      "TEST 5: void reverses allocations",
      true,
      `status=voided receipt=${voidedPay.receipt_number} reversed_rows=${reversedFromAdv}`,
    );

    // ========== TEST 6 — Reports / summary reconcile ==========
    const finalSum = await withRetry("final summary", summary);
    const { data: completedPays } = await admin
      .from("payments")
      .select("id, amount, status")
      .eq("student_id", studentId)
      .eq("status", "completed");
    const { data: activeAllocs } = await admin
      .from("payment_allocations")
      .select("amount, payment_id, charge_id")
      .eq("student_id", studentId)
      .is("reversed_at", null);
    const paid = (completedPays || []).reduce((a, p) => a + Number(p.amount), 0);
    const allocated = (activeAllocs || []).reduce((a, r) => a + Number(r.amount), 0);
    const credit = Math.max(0, paid - allocated);
    assert(
      Math.abs(credit - Number(finalSum.available_credit)) < 0.01,
      `credit mismatch summary=${finalSum.available_credit} derived=${credit}`,
    );
    record(
      "TEST 6: summary reconciles paid-allocated=credit",
      true,
      `paid=${paid} allocated=${allocated} credit=${credit} outstanding=${finalSum.outstanding_balance}`,
    );

    // ========== TEST 7 — Security ==========
    const { error: teacherPayErr } = await teacher.rpc("record_payment", {
      p_student_id: studentId,
      p_amount: 10,
      p_method: "mobile_money",
      p_idempotency_key: randomUUID(),
      p_reference_number: "DENIED",
      p_paid_on: new Date().toISOString().slice(0, 10),
      p_notes: "should fail",
    });
    assert(!!teacherPayErr, "teacher record_payment should fail");

    const { error: teacherApplyErr } = await teacher.rpc("apply_available_credit", {
      p_student_id: studentId,
    });
    assert(!!teacherApplyErr, "teacher apply_available_credit should fail");

    // Direct insert into payments should fail for authenticated bursar (revoked)
    const { error: insertPayErr } = await bursar.from("payments").insert({
      school_id: schoolId,
      student_id: studentId,
      amount: 1,
      method: "mobile_money",
      status: "completed",
      paid_on: new Date().toISOString().slice(0, 10),
      receipt_number: `HACK-${stamp}`,
      idempotency_key: randomUUID(),
    });
    assert(!!insertPayErr, "direct payment insert should be denied");

    record(
      "TEST 7: security denials",
      true,
      `teacher pay/apply denied; direct insert denied (${insertPayErr.message.slice(0, 80)})`,
    );

    // Cancel leftover optional charge used for credit apply if still outstanding.
    try {
      await bursar.rpc("cancel_optional_charge", { p_charge_id: chargeCredit });
    } catch {
      /* ignore cleanup errors */
    }    console.log("\nSMOKE_SUMMARY");
    console.log(
      JSON.stringify(
        {
          project_ref: ref,
          school_id: schoolId,
          student_id: studentId,
          admission,
          results,
          failed: results.filter((r) => !r.pass).length,
        },
        null,
        2,
      ),
    );

    if (results.some((r) => !r.pass)) process.exitCode = 1;
  } catch (e) {
    console.error("SMOKE_FATAL", e.message || e);
    record("FATAL", false, String(e.message || e));
    process.exitCode = 1;
  } finally {
    // Best-effort cleanup of disposable auth users (profiles cascade may vary)
    try {
      if (bursarId) await admin.auth.admin.deleteUser(bursarId);
      if (teacherId) await admin.auth.admin.deleteUser(teacherId);
    } catch (e) {
      console.warn("cleanup users:", e.message);
    }
    console.log(
      "Note: smoke pupil/charges left labeled SMOKE-* for audit; payments voided where possible.",
    );
  }
}

main();
