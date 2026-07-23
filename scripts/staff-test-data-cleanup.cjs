/**
 * Remove ONLY @bfa-smoke.local verification staff (Smoke / Polish Verify / Polish Audit).
 * Refuses to delete any non-smoke-domain account.
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
const SMOKE_DOMAIN = "@bfa-smoke.local";

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
      await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw last;
}

async function countEq(admin, table, column, id) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, id);
  if (error) return { count: null, error: error.message };
  return { count: count ?? 0, error: null };
}

function isApprovedTestAccount(fullName, email) {
  const mail = (email || "").toLowerCase();
  const name = (fullName || "").toLowerCase();
  const hay = `${name} ${mail}`;

  // Hard allow: smoke domain emails from verify scripts
  if (mail.endsWith(SMOKE_DOMAIN)) {
    return (
      hay.includes("smoke") ||
      hay.includes("polish") ||
      mail.startsWith("smoke-") ||
      mail.startsWith("polish-")
    );
  }

  // Allow clear verify display names even if Auth email lookup failed
  if (
    /^smoke test\b/.test(name) ||
    /^polish verify\b/.test(name) ||
    /^polish audit\b/.test(name) ||
    /^polish-(bursar|teacher|aud|tch)-/.test(name)
  ) {
    return true;
  }

  return false;
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
      .select("id, school_id, full_name, role, is_active, created_at")
      .eq("school_id", SCHOOL_ID)
      .order("full_name");
    if (res.error) throw new Error(res.error.message);
    return res;
  });
  assert(!error, error);

  const toRemove = [];
  const retained = [];

  for (const p of profiles || []) {
    const { data: authData, error: authErr } = await withRetry(
      `auth ${p.id}`,
      async () => admin.auth.admin.getUserById(p.id),
    );
    const email = authErr || !authData?.user ? null : authData.user.email ?? null;

    if (!isApprovedTestAccount(p.full_name, email)) {
      retained.push({
        id: p.id,
        full_name: p.full_name,
        role: p.role,
        email,
      });
      continue;
    }

    // Safety: never delete administrators on smoke domain either if somehow
    // linked as real — still allow smoke-domain admins only if name matches.
    const homeroom = await countEq(admin, "classes", "homeroom_teacher_id", p.id);
    assert(
      !homeroom.error,
      `classes check failed for ${p.id}: ${homeroom.error}`,
    );
    assert(
      homeroom.count === 0,
      `BLOCKED: ${p.full_name} is homeroom teacher (${homeroom.count} classes)`,
    );

    const covers = await countEq(
      admin,
      "class_attendance_covers",
      "staff_id",
      p.id,
    );
    assert(!covers.error, covers.error);
    // Covers cascade-delete with profile; log only.
    toRemove.push({
      id: p.id,
      full_name: p.full_name,
      role: p.role,
      email,
      attendance_covers: covers.count ?? 0,
    });
  }

  assert(toRemove.length > 0, "No approved test staff found to remove");
  assert(
    retained.length >= 1,
    "Refusing cleanup: would leave zero retained staff",
  );
  assert(
    retained.every((r) => {
      const mail = (r.email || "").toLowerCase();
      const name = (r.full_name || "").toLowerCase();
      if (mail.endsWith(SMOKE_DOMAIN)) return false;
      if (/^smoke test\b|^polish verify\b|^polish audit\b/.test(name)) return false;
      return true;
    }),
    "Internal error: smoke/polish test account classified as retained",
  );

  console.log(`removing=${toRemove.length} retaining=${retained.length}`);

  const ids = toRemove.map((r) => r.id);
  const removed = {
    password_reset_audits: 0,
    finance_event_audits: 0,
    attendance_covers: 0,
    auth_users: 0,
    profiles_after: 0,
    auth_failures: [],
  };

  // password_reset_audits — delete rows that solely target/initiate these users
  for (const col of ["target_profile_id", "initiated_by", "target_user_id"]) {
    await withRetry(`pra ${col}`, async () => {
      const { error: delErr, count } = await admin
        .from("password_reset_audits")
        .delete({ count: "exact" })
        .in(col, ids);
      if (delErr && !/does not exist|schema cache/i.test(delErr.message)) {
        throw new Error(`password_reset_audits ${col}: ${delErr.message}`);
      }
      removed.password_reset_audits += count || 0;
    });
  }

  // Optional finance audits referencing actor
  await withRetry("fea actor", async () => {
    const { error: delErr, count } = await admin
      .from("finance_event_audits")
      .delete({ count: "exact" })
      .in("actor_id", ids);
    if (delErr) {
      if (/does not exist|schema cache|column/i.test(delErr.message)) return;
      throw new Error(`finance_event_audits: ${delErr.message}`);
    }
    removed.finance_event_audits += count || 0;
  });

  // Cover assignments (ON DELETE CASCADE from profiles; clear first for clarity)
  await withRetry("class_attendance_covers", async () => {
    const { error: delErr, count } = await admin
      .from("class_attendance_covers")
      .delete({ count: "exact" })
      .in("staff_id", ids);
    if (delErr) {
      if (/does not exist|schema cache/i.test(delErr.message)) return;
      throw new Error(`class_attendance_covers: ${delErr.message}`);
    }
    removed.attendance_covers += count || 0;
  });

  // Delete Auth users (profiles cascade via ON DELETE CASCADE from auth.users)
  for (const row of toRemove) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      try {
        await withRetry(`deleteUser ${row.id}`, async () => {
          const { error: delErr } = await admin.auth.admin.deleteUser(row.id);
          if (delErr) {
            throw new Error(`deleteUser ${row.email}: ${delErr.message}`);
          }
        });
        removed.auth_users += 1;
        console.log(`deleted auth ${row.email}`);
        ok = true;
      } catch (e) {
        const msg = String(e.message || e);
        if (attempt === 4) {
          removed.auth_failures.push({
            id: row.id,
            email: row.email,
            error: msg,
          });
          console.error(msg);
        } else {
          console.warn(`retry delete ${row.email}: ${msg.slice(0, 100)}`);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Orphan @bfa-smoke.local auth users without profiles
  let page = 1;
  for (;;) {
    const { data, error: listErr } = await withRetry(`listUsers ${page}`, async () =>
      admin.auth.admin.listUsers({ page, perPage: 200 }),
    );
    if (listErr) throw new Error(listErr.message);
    const users = data?.users || [];
    if (!users.length) break;
    for (const u of users) {
      const email = (u.email || "").toLowerCase();
      if (!email.endsWith(SMOKE_DOMAIN)) continue;
      const stillProfile = (await admin.from("profiles").select("id").eq("id", u.id).maybeSingle())
        .data;
      if (stillProfile) continue;
      // already deleted profile path, or never had profile
      const already = toRemove.some((r) => r.id === u.id);
      if (already && removed.auth_failures.every((f) => f.id !== u.id)) continue;
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) {
        removed.auth_failures.push({
          id: u.id,
          email: u.email,
          error: delErr.message,
        });
      } else {
        removed.auth_users += 1;
        console.log(`deleted orphan auth ${u.email}`);
      }
    }
    if (users.length < 200) break;
    page += 1;
  }

  // Verify
  const { data: afterProfiles } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("school_id", SCHOOL_ID)
    .order("full_name");

  const leftoverSmoke = [];
  for (const p of afterProfiles || []) {
    const { data: authData } = await admin.auth.admin.getUserById(p.id);
    const email = authData?.user?.email ?? null;
    if ((email || "").toLowerCase().endsWith(SMOKE_DOMAIN)) {
      leftoverSmoke.push({ id: p.id, full_name: p.full_name, email });
    }
    if (/smoke|polish verify|polish audit/i.test(p.full_name || "")) {
      leftoverSmoke.push({ id: p.id, full_name: p.full_name, email, by_name: true });
    }
  }

  // Auth linkage check for retained (password-reset prerequisite)
  const resetReadiness = [];
  for (const r of retained) {
    const { data, error: gErr } = await admin.auth.admin.getUserById(r.id);
    resetReadiness.push({
      id: r.id,
      full_name: r.full_name,
      email: data?.user?.email ?? r.email,
      auth_linked: Boolean(data?.user?.email) && !gErr,
    });
  }

  const report = {
    school_id: SCHOOL_ID,
    cleaned_at: new Date().toISOString(),
    removed_staff: toRemove,
    retained_staff: retained,
    counts: removed,
    leftover_smoke: leftoverSmoke,
    password_reset_readiness: resetReadiness,
    profiles_remaining: (afterProfiles || []).length,
  };

  const outPath = path.join(process.cwd(), "scripts", ".staff-test-cleanup-result.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
  console.log(
    JSON.stringify(
      {
        removed: toRemove.length,
        auth_deleted: removed.auth_users,
        auth_failures: removed.auth_failures.length,
        profiles_remaining: report.profiles_remaining,
        leftover_smoke: leftoverSmoke.length,
      },
      null,
      2,
    ),
  );

  if (leftoverSmoke.length || removed.auth_failures.length) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
