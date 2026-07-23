/**
 * CI gate for Supabase migrations after historically manual SQL Editor applies.
 *
 * Runs `supabase migration list` (linked project) and decides whether
 * `supabase db push` is safe.
 *
 * Exit codes:
 *   0 — safe (synced, or only pending local migrations)
 *   2 — reconciliation required (do NOT db push)
 *   1 — unexpected failure / unsafe state
 *
 * Does not apply migrations. Does not print secrets.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

function listMigrationFiles() {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function parseList(output) {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    // Typical: "   20260715120000 | 20260715120000 | 2026-07-15 ..."
    // or pipe / whitespace tables from CLI versions
    if (/^Local/i.test(line) || /^---/.test(line) || /Time \(UTC\)/i.test(line)) {
      continue;
    }
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 2) {
      const local = parts[0] || "";
      const remote = parts[1] || "";
      if (/^\d{14}/.test(local) || /^\d{14}/.test(remote) || local === "" || remote === "") {
        rows.push({
          local: local.replace(/\s+.*/, ""),
          remote: remote.replace(/\s+.*/, ""),
        });
      }
      continue;
    }
    // Fallback whitespace columns
    const m = line.match(/^(\d{14}\w*)?\s+(\d{14}\w*)?/);
    if (m) {
      rows.push({ local: m[1] || "", remote: m[2] || "" });
    }
  }
  return rows;
}

function main() {
  const localFiles = listMigrationFiles();
  console.log(`local_migration_files=${localFiles.length}`);

  let output = "";
  try {
    output = run("supabase migration list");
  } catch (e) {
    const err = String(e.stderr || e.stdout || e.message || e);
    console.error("Failed to run `supabase migration list`.");
    console.error(err.slice(0, 500));
    console.error("");
    console.error("Ensure SUPABASE_ACCESS_TOKEN is set and the project is linked:");
    console.error("  supabase link --project-ref \"$SUPABASE_PROJECT_REF\"");
    process.exit(1);
  }

  console.log("--- supabase migration list ---");
  console.log(output);
  console.log("--- end ---");

  const rows = parseList(output);
  const remoteApplied = rows.filter((r) => r.remote && /^\d{14}/.test(r.remote));
  const localOnly = rows.filter(
    (r) => r.local && /^\d{14}/.test(r.local) && (!r.remote || r.remote === ""),
  );
  const remoteOnly = rows.filter(
    (r) => r.remote && /^\d{14}/.test(r.remote) && (!r.local || r.local === ""),
  );

  console.log(`parsed_rows=${rows.length}`);
  console.log(`remote_applied=${remoteApplied.length}`);
  console.log(`local_pending=${localOnly.length}`);
  console.log(`remote_only=${remoteOnly.length}`);

  // History empty on remote but many local files → manual SQL Editor history.
  if (remoteApplied.length === 0 && localFiles.length > 5) {
    console.error("");
    console.error("MIGRATION_RECONCILIATION_REQUIRED");
    console.error("");
    console.error(
      "Remote migration history is empty (or unreadable) while this repo has",
      localFiles.length,
      "SQL files under supabase/migrations.",
    );
    console.error(
      "This project previously applied migrations via the Supabase SQL Editor.",
    );
    console.error("Do NOT run `supabase db push` until history is repaired.");
    console.error("");
    console.error("Exact reconciliation (staging only):");
    console.error("  1. Confirm project ref matches staging (qaczvlbgsxcrdcdgsfpo).");
    console.error("  2. For each migration version already applied as objects in the DB,");
    console.error("     mark it applied WITHOUT re-running SQL:");
    console.error("");
    console.error("       supabase migration repair --status applied <version>");
    console.error("");
    console.error("     Example version from filename 20260715120000_core_config_data.sql:");
    console.error("       supabase migration repair --status applied 20260715120000");
    console.error("");
    console.error("  3. Repeat for every already-applied version (or batch carefully).");
    console.error("  4. Re-run: supabase migration list");
    console.error("  5. When Local and Remote match for applied versions, and only");
    console.error("     truly pending files remain Local-only, re-run this gate.");
    console.error("  6. Then `supabase db push` is safe for pending migrations only.");
    console.error("");
    console.error("See docs/GITHUB_ACTIONS_PIPELINE.md § Migration reconciliation.");
    process.exit(2);
  }

  if (remoteOnly.length > 0) {
    console.error("");
    console.error("UNSAFE: remote has migration versions not present in this repo.");
    console.error(JSON.stringify(remoteOnly, null, 2));
    console.error("Do not db push until the working tree includes those migrations.");
    process.exit(1);
  }

  if (localOnly.length === 0) {
    console.log("MIGRATION_STATUS=synced");
    console.log("No pending migrations. db push would be a no-op.");
    process.exit(0);
  }

  console.log("MIGRATION_STATUS=pending_safe");
  console.log(
    "Pending local migrations (safe to push if objects are not already live):",
  );
  for (const r of localOnly) {
    console.log("  -", r.local);
  }
  process.exit(0);
}

main();
