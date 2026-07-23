/**
 * Remove partial Exam Verify rows created before migration 303.
 * Safe: only names matching Exam Verify%.
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

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: periods } = await admin
    .from("exam_periods")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .ilike("name", "Exam Verify%");

  for (const p of periods || []) {
    const { data: exams } = await admin
      .from("exams")
      .select("id")
      .eq("exam_period_id", p.id);
    const examIds = (exams || []).map((e) => e.id);
    if (examIds.length) {
      await admin.from("exam_invigilators").delete().in(
        "exam_schedule_id",
        (
          await admin
            .from("exam_schedules")
            .select("id")
            .in("exam_id", examIds)
        ).data?.map((s) => s.id) || [],
      );
      await admin.from("exam_schedules").delete().in("exam_id", examIds);
      await admin.from("exam_exclusions").delete().in("exam_id", examIds);
      await admin.from("exams").delete().in("id", examIds);
    }
    await admin.from("exam_periods").delete().eq("id", p.id);
    console.log("removed period", p.name);
  }

  const { data: rooms } = await admin
    .from("exam_rooms")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .ilike("name", "Exam Verify%");
  for (const r of rooms || []) {
    await admin.from("exam_rooms").delete().eq("id", r.id);
    console.log("removed room", r.name);
  }

  const { data: subjects } = await admin
    .from("subjects")
    .select("id, name")
    .eq("school_id", SCHOOL_ID)
    .ilike("name", "Exam Verify%");
  for (const s of subjects || []) {
    await admin.from("subjects").delete().eq("id", s.id);
    console.log("removed subject", s.name);
  }

  console.log("CLEANUP_PARTIAL_OK");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
