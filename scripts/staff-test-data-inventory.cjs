/**
 * Inventory staff/profiles for test-account cleanup (read-only).
 * Does not delete anything.
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

/** Conservative matcher — only clear verification/demo naming. */
function classifyTestStaff(fullName, email) {
  const name = (fullName || "").toLowerCase().trim();
  const mail = (email || "").toLowerCase().trim();
  const hay = `${name} ${mail}`;

  const reasons = [];
  if (/\bsmoke\b/.test(hay)) reasons.push("smoke");
  if (/\bpolish\b/.test(hay) && /\bverify\b/.test(hay)) reasons.push("polish_verify");
  if (/\bfinance\b/.test(hay) && /\bverify\b/.test(hay)) reasons.push("finance_verify");
  if (/\bverification\b/.test(hay) || /\bverify staff\b/.test(hay))
    reasons.push("verification");
  if (/\bdemo\b/.test(hay)) reasons.push("demo");
  if (/\bdummy\b/.test(hay)) reasons.push("dummy");
  if (/\bpassword\s*reset\b/.test(hay) || /pwreset|pwd-reset|password-reset/.test(hay))
    reasons.push("password_reset_test");
  // Explicit test-named staff (not "contest", etc.)
  if (/\btest\b/.test(name) || /^test[@.]/.test(mail) || /[+._-]test[@.]/.test(mail))
    reasons.push("test");
  if (/@(example\.com|test\.local|mailinator\.com)$/.test(mail))
    reasons.push("disposable_email_domain");

  return reasons;
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
        !/fetch failed|timeout|ECONNRESET|ConnectTimeout|ETIMEDOUT/i.test(msg) ||
        i === attempts - 1
      ) {
        throw e;
      }
      console.warn(`retry ${label} (${i + 1}): ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

async function countEq(admin, table, column, id) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, id);
  if (error) {
    // Table may not exist in older envs — treat as unknown
    return { count: null, error: error.message };
  }
  return { count: count ?? 0, error: null };
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

  const { data: profiles, error } = await withRetry("profiles", async () => {
    const res = await admin
      .from("profiles")
      .select("id, school_id, full_name, role, phone, is_active, created_at")
      .eq("school_id", SCHOOL_ID)
      .order("full_name");
    if (res.error) throw new Error(res.error.message);
    return res;
  });
  if (error) throw error;

  const list = profiles || [];
  console.log(`profiles_in_school=${list.length}`);

  const candidates = [];
  const retained = [];

  for (const p of list) {
    const { data: authData, error: authErr } = await withRetry(
      `auth ${p.id}`,
      async () => admin.auth.admin.getUserById(p.id),
    );
    const email = authErr || !authData?.user ? null : authData.user.email ?? null;
    const reasons = classifyTestStaff(p.full_name, email);

    const refs = {};
    const checks = [
      ["classes_homeroom", "classes", "homeroom_teacher_id"],
      ["class_attendance_covers", "class_attendance_covers", "staff_id"],
      ["attendance_recorded", "attendance_records", "recorded_by"],
      ["payments_recorded", "payments", "recorded_by"],
      ["charges_created", "charges", "created_by"],
      ["discipline_recorded", "discipline_incidents", "recorded_by"],
      ["password_reset_target", "password_reset_audits", "target_profile_id"],
      ["password_reset_initiated", "password_reset_audits", "initiated_by"],
    ];

    for (const [key, table, col] of checks) {
      refs[key] = await countEq(admin, table, col, p.id);
    }

    const row = {
      id: p.id,
      full_name: p.full_name,
      role: p.role,
      is_active: p.is_active,
      email,
      auth_present: Boolean(authData?.user),
      reasons,
      refs,
    };

    if (reasons.length) {
      candidates.push(row);
    } else {
      retained.push(row);
    }
  }

  // Orphan auth users with matching emails but no profile (list page of users)
  const orphanAuth = [];
  let page = 1;
  for (;;) {
    const { data, error: listErr } = await withRetry(`auth list ${page}`, async () =>
      admin.auth.admin.listUsers({ page, perPage: 200 }),
    );
    if (listErr) throw new Error(listErr.message);
    const users = data?.users || [];
    if (!users.length) break;
    for (const u of users) {
      const hasProfile = list.some((p) => p.id === u.id);
      if (hasProfile) continue;
      const reasons = classifyTestStaff(u.user_metadata?.full_name, u.email);
      if (reasons.length) {
        orphanAuth.push({
          id: u.id,
          email: u.email,
          full_name: u.user_metadata?.full_name ?? null,
          reasons,
        });
      }
    }
    if (users.length < 200) break;
    page += 1;
  }

  const out = {
    school_id: SCHOOL_ID,
    generated_at: new Date().toISOString(),
    totals: {
      profiles: list.length,
      candidates: candidates.length,
      retained: retained.length,
      orphan_auth_test_named: orphanAuth.length,
    },
    candidates,
    retained: retained.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      role: r.role,
      email: r.email,
      is_active: r.is_active,
    })),
    orphan_auth_test_named: orphanAuth,
  };

  const outPath = path.join(
    process.cwd(),
    "scripts",
    ".staff-test-inventory.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${outPath}`);
  console.log(JSON.stringify(out.totals, null, 2));
  console.log("--- candidates ---");
  for (const c of candidates) {
    console.log(
      JSON.stringify({
        id: c.id,
        full_name: c.full_name,
        email: c.email,
        role: c.role,
        reasons: c.reasons,
        refs: Object.fromEntries(
          Object.entries(c.refs).map(([k, v]) => [k, v.count]),
        ),
      }),
    );
  }
  if (orphanAuth.length) {
    console.log("--- orphan auth ---");
    console.log(JSON.stringify(orphanAuth, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
