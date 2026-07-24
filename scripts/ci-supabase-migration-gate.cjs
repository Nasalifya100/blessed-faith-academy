/**
 * CI gate for Supabase migrations after historically manual SQL Editor applies.
 *
 * Prefers `supabase migration list --output-format json` when available,
 * otherwise parses the human table robustly (backticks, ANSI, CRLF, etc.).
 *
 * Exit codes:
 *   0 — safe (synced, or only pending local migrations)
 *   2 — reconciliation required (remote history empty while local SQL exists)
 *   3 — migration list parse error (do NOT treat as empty history / repair)
 *   1 — unexpected failure / unsafe state (remote-only, mismatch, CLI failure)
 *
 * Does not apply migrations. Does not print secrets.
 *
 * Env overrides (tests / offline):
 *   MIGRATION_LIST_OUTPUT — use this string instead of running the CLI
 *   MIGRATION_LIST_FILE — read list output from this file path
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const VERSION_RE = /^\d{14}$/;
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(value) {
  return String(value || "").replace(ANSI_RE, "");
}

function normalizeCell(raw) {
  let value = stripAnsi(raw);
  value = value.replace(/\u00a0/g, " ").trim();
  // Surrounding backticks from pretty CLI tables: `20260715120000`
  if (value.startsWith("`") && value.endsWith("`") && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }
  // Drop trailing labels if a CLI ever appends text after the version.
  const versionMatch = value.match(/^(\d{14})\b/);
  if (versionMatch) {
    return versionMatch[1];
  }
  return value === "" ? "" : value;
}

function asVersion(value) {
  return VERSION_RE.test(value) ? value : "";
}

/**
 * Parse `supabase migration list` text (or JSON) into classified rows.
 * @returns {{ rows: Array<{local:string,remote:string,kind:string}>, parsedRows: number, source: string }}
 */
function parseMigrationList(output) {
  const text = String(output || "");
  const trimmed = text.trim();

  // Official machine-readable format (Supabase CLI --output-format json).
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      const migrations = Array.isArray(json)
        ? json
        : Array.isArray(json.migrations)
          ? json.migrations
          : null;
      if (migrations) {
        const rows = migrations
          .map((m) => {
            const local = asVersion(normalizeCell(m.local ?? m.Local ?? ""));
            const remote = asVersion(normalizeCell(m.remote ?? m.Remote ?? ""));
            return classifyRow(local, remote);
          })
          .filter((r) => r.kind !== "ignored");
        return { rows, parsedRows: rows.length, source: "json" };
      }
    } catch {
      // Fall through to table parser.
    }
  }

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const classified = parseTableLine(line);
    if (classified && classified.kind !== "ignored") {
      rows.push(classified);
    }
  }
  return { rows, parsedRows: rows.length, source: "table" };
}

function parseTableLine(line) {
  const cleaned = stripAnsi(line).replace(/\u00a0/g, " ");
  if (!cleaned.trim()) {
    return { local: "", remote: "", kind: "ignored" };
  }

  // Informational / skip noise
  if (/Skipping migration/i.test(cleaned)) {
    return { local: "", remote: "", kind: "ignored" };
  }
  if (/Initialising login role/i.test(cleaned)) {
    return { local: "", remote: "", kind: "ignored" };
  }
  if (/Connecting to remote database/i.test(cleaned)) {
    return { local: "", remote: "", kind: "ignored" };
  }
  if (/file name must match pattern/i.test(cleaned)) {
    return { local: "", remote: "", kind: "ignored" };
  }

  if (!cleaned.includes("|")) {
    return { local: "", remote: "", kind: "ignored" };
  }

  const parts = cleaned.split("|").map((p) => normalizeCell(p));
  if (parts.length < 2) {
    return { local: "", remote: "", kind: "ignored" };
  }

  const localRaw = parts[0];
  const remoteRaw = parts[1];

  // Header / separator
  if (/^local$/i.test(localRaw) || /^remote$/i.test(remoteRaw)) {
    return { local: "", remote: "", kind: "ignored" };
  }
  if (/^-{2,}$/.test(localRaw) || /^-{2,}$/.test(remoteRaw)) {
    return { local: "", remote: "", kind: "ignored" };
  }
  if (/^-+$/.test(localRaw.replace(/\s/g, "")) && remoteRaw.replace(/-/g, "") === "") {
    return { local: "", remote: "", kind: "ignored" };
  }

  const local = asVersion(localRaw);
  const remote = asVersion(remoteRaw);

  // Timestamp-only / unrelated pipe rows with no valid version in Local/Remote
  if (!local && !remote) {
    return { local: "", remote: "", kind: "ignored" };
  }

  return classifyRow(local, remote);
}

function classifyRow(local, remote) {
  if (local && remote) {
    if (local === remote) {
      return { local, remote, kind: "matched" };
    }
    return { local, remote, kind: "mismatch" };
  }
  if (local && !remote) {
    return { local, remote: "", kind: "local-only" };
  }
  if (!local && remote) {
    return { local: "", remote, kind: "remote-only" };
  }
  return { local: "", remote: "", kind: "ignored" };
}

/**
 * Decide gate outcome from parsed rows + local SQL file count.
 * @returns {{ code: number, status: string, message: string, counts: object, details: object }}
 */
function evaluateMigrationGate({ rows, parsedRows, localFileCount }) {
  const matched = rows.filter((r) => r.kind === "matched");
  const localOnly = rows.filter((r) => r.kind === "local-only");
  const remoteOnly = rows.filter((r) => r.kind === "remote-only");
  const mismatches = rows.filter((r) => r.kind === "mismatch");
  const remoteApplied = rows.filter((r) => r.remote);

  const counts = {
    parsed_rows: parsedRows,
    matched: matched.length,
    remote_applied: remoteApplied.length,
    local_pending: localOnly.length,
    remote_only: remoteOnly.length,
    mismatches: mismatches.length,
    local_migration_files: localFileCount,
  };

  if (parsedRows === 0) {
    return {
      code: 3,
      status: "MIGRATION_LIST_PARSE_ERROR",
      message:
        "Could not parse any migration table rows from `supabase migration list`. " +
        "This is a parser/CLI output problem — NOT proof that remote history is empty. " +
        "Do NOT run `supabase migration repair`. Fix the gate/parser or CLI output first.",
      counts,
      details: { localOnly: [], remoteOnly: [], mismatches: [] },
    };
  }

  if (mismatches.length > 0) {
    return {
      code: 1,
      status: "UNSAFE_MISMATCH",
      message:
        "Local and Remote versions differ on one or more rows. Do not run `supabase db push`.",
      counts,
      details: {
        localOnly: localOnly.map((r) => r.local),
        remoteOnly: remoteOnly.map((r) => r.remote),
        mismatches,
      },
    };
  }

  if (remoteOnly.length > 0) {
    return {
      code: 1,
      status: "UNSAFE_REMOTE_ONLY",
      message:
        "Remote has migration versions not present in this repo. Do not db push until the working tree includes those migrations.",
      counts,
      details: {
        localOnly: localOnly.map((r) => r.local),
        remoteOnly: remoteOnly.map((r) => r.remote),
        mismatches: [],
      },
    };
  }

  // Genuinely empty remote history: every valid row has empty Remote, and local SQL exists.
  if (
    localFileCount > 0 &&
    parsedRows > 0 &&
    remoteApplied.length === 0 &&
    localOnly.length === parsedRows
  ) {
    return {
      code: 2,
      status: "MIGRATION_RECONCILIATION_REQUIRED",
      message:
        "Remote migration history is empty while local SQL migrations exist. " +
        "Do NOT run `supabase db push` until history is independently verified and repaired.",
      counts,
      details: {
        localOnly: localOnly.map((r) => r.local),
        remoteOnly: [],
        mismatches: [],
      },
    };
  }

  if (localOnly.length === 0 && mismatches.length === 0 && remoteOnly.length === 0) {
    return {
      code: 0,
      status: "synced",
      message: "No pending migrations. db push would be a no-op.",
      counts,
      details: { localOnly: [], remoteOnly: [], mismatches: [] },
    };
  }

  // Pending local-only rows with an otherwise matched/understood remote history.
  return {
    code: 0,
    status: "pending_safe",
    message:
      "Pending local migrations (safe to push if objects are not already live).",
    counts,
    details: {
      localOnly: localOnly.map((r) => r.local),
      remoteOnly: [],
      mismatches: [],
    },
  };
}

function listMigrationFiles(cwd = process.cwd()) {
  const dir = path.join(cwd, "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

function loadMigrationListOutput() {
  if (process.env.MIGRATION_LIST_OUTPUT != null && process.env.MIGRATION_LIST_OUTPUT !== "") {
    return { output: process.env.MIGRATION_LIST_OUTPUT, via: "env" };
  }
  if (process.env.MIGRATION_LIST_FILE) {
    return {
      output: fs.readFileSync(process.env.MIGRATION_LIST_FILE, "utf8"),
      via: "file",
    };
  }

  // Prefer official JSON when available (Supabase CLI ≥2 with --output-format json).
  try {
    const jsonOut = run("supabase migration list --output-format json");
    // Some CLI builds print informational lines before JSON; extract the object.
    const idx = jsonOut.indexOf("{");
    if (idx >= 0) {
      return { output: jsonOut.slice(idx), via: "cli-json" };
    }
    return { output: jsonOut, via: "cli-json" };
  } catch {
    // Fall back to human table.
  }

  try {
    return { output: run("supabase migration list"), via: "cli-table" };
  } catch (e) {
    const err = String(e.stderr || e.stdout || e.message || e);
    console.error("Failed to run `supabase migration list`.");
    console.error(err.slice(0, 500));
    console.error("");
    console.error("Ensure SUPABASE_ACCESS_TOKEN is set and the project is linked:");
    console.error("  supabase link --project-ref \"$SUPABASE_PROJECT_REF\"");
    process.exit(1);
  }
}

function printReconciliationHelp(localFileCount) {
  console.error("");
  console.error("MIGRATION_RECONCILIATION_REQUIRED");
  console.error("");
  console.error(
    "Remote migration history is empty while this repo has",
    localFileCount,
    "SQL files under supabase/migrations.",
  );
  console.error(
    "This was independently verified as empty Remote columns on every parsed row.",
  );
  console.error("Do NOT run `supabase db push` until history is repaired.");
  console.error("");
  console.error("Exact reconciliation (staging only) — only after confirming empty history:");
  console.error("  1. Confirm project ref matches staging (qaczvlbgsxcrdcdgsfpo).");
  console.error("  2. For each migration version already applied as objects in the DB,");
  console.error("     mark it applied WITHOUT re-running SQL:");
  console.error("");
  console.error("       supabase migration repair --status applied <version>");
  console.error("");
  console.error("  3. Re-run: supabase migration list");
  console.error("  4. Re-run this gate.");
  console.error("");
  console.error("See docs/GITHUB_ACTIONS_PIPELINE.md § Migration reconciliation.");
  console.error(
    "NOTE: If parsed_rows=0, that is MIGRATION_LIST_PARSE_ERROR — never repair for that.",
  );
}

function main() {
  const localFiles = listMigrationFiles();
  console.log(`local_migration_files=${localFiles.length}`);

  const { output, via } = loadMigrationListOutput();
  console.log(`migration_list_source=${via}`);
  console.log("--- supabase migration list ---");
  console.log(output);
  console.log("--- end ---");

  const { rows, parsedRows, source } = parseMigrationList(output);
  console.log(`parse_source=${source}`);

  const result = evaluateMigrationGate({
    rows,
    parsedRows,
    localFileCount: localFiles.length,
  });

  console.log(`parsed_rows=${result.counts.parsed_rows}`);
  console.log(`matched=${result.counts.matched}`);
  console.log(`remote_applied=${result.counts.remote_applied}`);
  console.log(`local_pending=${result.counts.local_pending}`);
  console.log(`remote_only=${result.counts.remote_only}`);
  console.log(`mismatches=${result.counts.mismatches}`);

  if (result.code === 3) {
    console.error("");
    console.error("MIGRATION_LIST_PARSE_ERROR");
    console.error("");
    console.error(result.message);
    console.error("");
    console.error("Do NOT run `supabase migration repair` for a parse failure.");
    console.error("Do NOT treat this as empty remote history.");
    process.exit(3);
  }

  if (result.code === 2) {
    printReconciliationHelp(localFiles.length);
    process.exit(2);
  }

  if (result.code !== 0) {
    console.error("");
    console.error(result.status);
    console.error(result.message);
    if (result.details.remoteOnly.length) {
      console.error("remote_only=", JSON.stringify(result.details.remoteOnly));
    }
    if (result.details.mismatches.length) {
      console.error("mismatches=", JSON.stringify(result.details.mismatches, null, 2));
    }
    process.exit(result.code);
  }

  if (result.status === "synced") {
    console.log("MIGRATION_STATUS=synced");
    console.log(result.message);
    process.exit(0);
  }

  console.log("MIGRATION_STATUS=pending_safe");
  console.log(result.message);
  for (const v of result.details.localOnly) {
    console.log("  -", v);
  }
  process.exit(0);
}

module.exports = {
  stripAnsi,
  normalizeCell,
  parseMigrationList,
  parseTableLine,
  classifyRow,
  evaluateMigrationGate,
  listMigrationFiles,
  VERSION_RE,
};

if (require.main === module) {
  main();
}
