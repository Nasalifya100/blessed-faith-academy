/**
 * Apply Phase 2A migrations to staging via Postgres URL.
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
  "20260723120000_academic_audit_and_capabilities.sql",
  "20260723120100_classes_stream_support.sql",
  "20260723120200_subjects_prerequisites_offerings.sql",
  "20260723120300_teaching_assignments.sql",
  "20260723120400_grading_assessment_weights_workflow.sql",
];

async function baseline(client) {
  const q = async (sql) => (await client.query(sql)).rows[0];
  const classes = await q("select count(*)::int as n from public.classes");
  const grades = await q("select count(*)::int as n from public.grade_levels");
  const years = await q("select count(*)::int as n from public.academic_years");
  const terms = await q("select count(*)::int as n from public.terms");
  const profiles = await q(
    "select count(*)::int as n from public.profiles where is_active",
  );
  const uniq = await client.query(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and tablename = 'classes'
    order by indexname
  `);
  const constr = await client.query(`
    select conname
    from pg_constraint
    where conrelid = 'public.classes'::regclass
    order by conname
  `);
  return {
    classes: classes.n,
    grades: grades.n,
    years: years.n,
    terms: terms.n,
    active_profiles: profiles.n,
    class_indexes: uniq.rows.map((r) => r.indexname),
    class_constraints: constr.rows.map((r) => r.conname),
  };
}

async function verifyStructure(client) {
  const tables = [
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
    "academic_event_audits",
    "academic_capabilities",
    "academic_settings",
  ];
  const present = {};
  for (const t of tables) {
    const { rows } = await client.query(
      `select to_regclass('public.${t}') is not null as ok`,
    );
    present[t] = rows[0].ok;
  }
  const stream = await client.query(`
    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='classes' and column_name='stream_code'
    ) as ok
  `);
  const oldUnique = await client.query(`
    select exists (
      select 1 from pg_constraint
      where conname = 'classes_academic_year_id_grade_level_id_key'
    ) as still_there
  `);
  const funcs = [
    "create_class",
    "upsert_subject",
    "bulk_set_grade_subject_offerings",
    "assign_subject_teacher",
    "save_grading_scheme",
    "save_weight_scheme",
    "has_academic_capability",
    "log_academic_event",
  ];
  const functions = {};
  for (const f of funcs) {
    const { rows } = await client.query(
      `select exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1
       ) as ok`,
      [f],
    );
    functions[f] = rows[0].ok;
  }
  return {
    tables: present,
    stream_code: stream.rows[0].ok,
    old_unique_still_present: oldUnique.rows[0].still_there,
    functions,
  };
}

async function main() {
  const only = process.argv[2]; // optional: baseline | migrate | verify
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    env.DATABASE_URL ||
    env.SUPABASE_DB_URL ||
    env.POSTGRES_URL;

  if (!dbUrl) {
    console.error(
      "MISSING_DB_URL: set DATABASE_URL (or SUPABASE_DB_URL) in .env.local to the staging Postgres connection string.",
    );
    process.exit(2);
  }

  // Masked host only
  try {
    const u = new URL(dbUrl.replace(/^postgresql:/, "postgres:"));
    console.log(`db_host=${u.hostname} db_name=${u.pathname.replace(/^\//, "")}`);
  } catch {
    console.log("db_host=(unparsed)");
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    if (!only || only === "baseline") {
      const before = await baseline(client);
      console.log("BASELINE", JSON.stringify(before, null, 2));
      if (only === "baseline") return;
    }

    if (!only || only === "migrate") {
      for (const file of MIGRATIONS) {
        const full = path.join(process.cwd(), "supabase", "migrations", file);
        const sql = fs.readFileSync(full, "utf8");
        console.log(`APPLY ${file} ...`);
        await client.query("begin");
        try {
          await client.query(sql);
          await client.query("commit");
          console.log(`OK ${file}`);
        } catch (e) {
          await client.query("rollback");
          console.error(`FAIL ${file}: ${e.message}`);
          throw e;
        }
      }
    }

    if (!only || only === "verify" || only === "migrate") {
      const after = await baseline(client);
      const structure = await verifyStructure(client);
      console.log("AFTER_COUNTS", JSON.stringify(after, null, 2));
      console.log("STRUCTURE", JSON.stringify(structure, null, 2));
      const missingTables = Object.entries(structure.tables)
        .filter(([, ok]) => !ok)
        .map(([t]) => t);
      const missingFns = Object.entries(structure.functions)
        .filter(([, ok]) => !ok)
        .map(([t]) => t);
      if (
        missingTables.length ||
        missingFns.length ||
        !structure.stream_code ||
        structure.old_unique_still_present
      ) {
        console.error("STRUCTURE_VERIFY_FAILED", {
          missingTables,
          missingFns,
          stream_code: structure.stream_code,
          old_unique_still_present: structure.old_unique_still_present,
        });
        process.exit(3);
      }
      console.log("STRUCTURE_VERIFY_OK");
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
