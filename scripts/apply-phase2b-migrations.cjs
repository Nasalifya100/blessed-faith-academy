/**
 * Apply Phase 2B migrations to staging via Postgres URL.
 * Reads .env.local for DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL.
 * Does not print secrets.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

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

const MIGRATIONS = [
  "20260723130000_exam_rooms_and_capabilities.sql",
  "20260723130100_exam_periods_exams_schedules.sql",
  "20260723130200_exam_setup_rpcs.sql",
  "20260723130300_exam_references_and_status_workflow.sql",
];

async function main() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = loadEnv(envPath);
  const dbUrl =
    env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL || "";
  if (!dbUrl) {
    console.error(
      "No DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL in .env.local",
    );
    process.exit(2);
  }

  const hostHint = (() => {
    try {
      return new URL(dbUrl.replace(/^postgres(ql)?:/, "http:")).hostname;
    } catch {
      return "(unparsed)";
    }
  })();
  console.log("db_host=" + hostHint);
  console.log("supabase_url_host=" + new URL(env.NEXT_PUBLIC_SUPABASE_URL).host);

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const school = await client.query(
      `select name from public.schools where id = '516977ed-8612-4e27-addc-cdb5cdb72505'`,
    );
    console.log("school=", school.rows[0]?.name || "(missing)");

    const baseline = {
      classes: (
        await client.query(`select count(*)::int as n from public.classes`)
      ).rows[0].n,
      subjects: (
        await client.query(
          `select count(*)::int as n from public.subjects`,
        ).catch(() => ({ rows: [{ n: null }] }))
      ).rows?.[0]?.n,
      exam_periods: (
        await client.query(
          `select count(*)::int as n from public.exam_periods`,
        ).catch(() => ({ rows: [{ n: 0 }] }))
      ).rows?.[0]?.n,
    };
    console.log("baseline=", JSON.stringify(baseline));

    for (const file of MIGRATIONS) {
      const full = path.join(process.cwd(), "supabase", "migrations", file);
      const sql = fs.readFileSync(full, "utf8");
      console.log("\nAPPLY " + file);
      try {
        await client.query(sql);
        console.log("OK " + file);
      } catch (e) {
        console.error("FAIL " + file + ": " + e.message);
        process.exit(1);
      }
    }

    const checks = await client.query(`
      select
        (select count(*) from information_schema.columns
          where table_schema='public' and table_name='exams' and column_name='exam_reference') as has_ref,
        (select count(*) from information_schema.columns
          where table_schema='public' and table_name='exams' and column_name='status') as has_status,
        (select count(*) from pg_proc where proname='allocate_exam_reference') as has_alloc,
        (select count(*) from pg_proc where proname='transition_exam_status') as has_transition,
        (select count(*) from pg_tables where schemaname='public' and tablename='exam_rooms') as has_rooms
    `);
    console.log("verify=", JSON.stringify(checks.rows[0]));
    console.log("PHASE2B_MIGRATIONS_OK");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
