#!/usr/bin/env node
/**
 * Production preflight — never applies migrations or deploys.
 *
 * Usage:
 *   node scripts/production-preflight.cjs --offline
 *   node scripts/production-preflight.cjs --online
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const offline = args.has("--offline") || !args.has("--online");

const EXPECTED_WORKER = "bfa-sms-staging";
const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
const REQUIRED_VERIFIERS = [
  "scripts/phase2b-staging-verify.cjs",
  "scripts/phase2c-stage1-verify.cjs",
  "scripts/phase2d-stage1-verify.cjs",
  "scripts/phase2d2-report-cards-verify.cjs",
];

/** @type {{ level: "ok"|"warn"|"fail"; message: string }[]} */
const findings = [];

function ok(message) {
  findings.push({ level: "ok", message });
}
function warn(message) {
  findings.push({ level: "warn", message });
}
function fail(message) {
  findings.push({ level: "fail", message });
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function checkRepoBasics() {
  if (!exists("package.json") || !exists("wrangler.jsonc")) {
    fail("Missing package.json or wrangler.jsonc at repository root.");
    return;
  }
  ok("Repository root looks like Blessed Faith Academy SMS.");

  const pkg = readJson("package.json");
  if (pkg.name !== "blessed-faith-academy") {
    warn(`Unexpected package name: ${pkg.name}`);
  } else {
    ok(`package.json name=${pkg.name} version=${pkg.version}`);
  }

  const wrangler = readText("wrangler.jsonc");
  if (!wrangler.includes(`"name": "${EXPECTED_WORKER}"`)) {
    fail(`wrangler worker name is not ${EXPECTED_WORKER}.`);
  } else {
    ok(`Target Worker confirmed: ${EXPECTED_WORKER}`);
  }

  if (!exists(".github/workflows/deploy-staging.yml")) {
    fail("Missing deploy-staging workflow.");
  } else {
    ok("Deploy staging workflow present.");
  }
}

function checkVerifiers() {
  for (const rel of REQUIRED_VERIFIERS) {
    if (exists(rel)) ok(`Verifier present: ${rel}`);
    else fail(`Missing verifier: ${rel}`);
  }
  if (exists("scripts/operational-integrity-verify.cjs")) {
    ok("Operational integrity verifier present.");
  } else {
    warn("operational-integrity-verify.cjs missing.");
  }
}

function checkMigrationsLocal() {
  const migDir = path.join(ROOT, "supabase", "migrations");
  if (!fs.existsSync(migDir)) {
    fail("supabase/migrations missing.");
    return;
  }
  const files = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    fail("No migration files found.");
    return;
  }
  ok(`Local migrations counted: ${files.length}`);
  const latest = files[files.length - 1];
  ok(`Latest local migration: ${latest}`);

  // Soft check for destructive patterns (informational).
  let destructiveHints = 0;
  for (const f of files.slice(-15)) {
    const sql = fs.readFileSync(path.join(migDir, f), "utf8");
    if (/\bdrop table\b/i.test(sql) && !/if exists/i.test(sql)) {
      destructiveHints += 1;
    }
  }
  if (destructiveHints > 0) {
    warn(
      `${destructiveHints} recent migration(s) contain DROP TABLE without IF EXISTS (review before apply).`,
    );
  } else {
    ok("No obvious unprotected DROP TABLE in recent migrations.");
  }
}

function checkBuildMetadata() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
  const sha = process.env.NEXT_PUBLIC_GIT_SHA || process.env.GITHUB_SHA || "unknown";
  const envName =
    process.env.NEXT_PUBLIC_DEPLOY_ENV || process.env.DEPLOY_ENV || "unknown";
  ok(`Build metadata preview version=${version} sha=${String(sha).slice(0, 12)} env=${envName}`);
}

function checkEnvOffline() {
  for (const key of REQUIRED_ENV) {
    if (process.env[key]) ok(`Env present: ${key}`);
    else warn(`Env not set in this shell: ${key} (required at runtime/CI).`);
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    ok("SUPABASE_SERVICE_ROLE_KEY present in shell (value not printed).");
  } else {
    warn("SUPABASE_SERVICE_ROLE_KEY not set in this shell.");
  }
}

function checkGitCleanExpectation() {
  try {
    const status = execSync("git status --porcelain", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    if (status) {
      warn(
        "Working tree has local changes. Production cutovers should prefer a clean tree.",
      );
    } else {
      ok("Working tree clean.");
    }
  } catch {
    warn("Could not inspect git status.");
  }
}

function checkOnlineAlignment() {
  if (offline) {
    ok("Online migration alignment skipped (--offline).");
    return;
  }
  try {
    const out = execSync("npx supabase migration list", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (/^\s*\|\s+\|/m.test(out) || /Local\s+\|\s+Remote/i.test(out)) {
      ok("supabase migration list executed (review pending rows manually).");
    } else {
      ok("supabase migration list executed.");
    }
    if (/^\s*[0-9]{14}\s+\|\s*$/m.test(out)) {
      fail("Pending local migrations detected (not applied remotely). Do not deploy blindly.");
    }
  } catch (err) {
    fail(
      `Online migration list failed: ${err instanceof Error ? err.message : "unknown"}. Preflight does not apply migrations.`,
    );
  }
}

function main() {
  console.log("=== BFA production preflight ===");
  console.log(`mode=${offline ? "offline" : "online"} root=${ROOT}`);
  console.log("This script NEVER applies migrations or deploys.\n");

  checkRepoBasics();
  checkVerifiers();
  checkMigrationsLocal();
  checkBuildMetadata();
  checkEnvOffline();
  checkGitCleanExpectation();
  checkOnlineAlignment();

  let fails = 0;
  let warns = 0;
  for (const f of findings) {
    const tag = f.level.toUpperCase();
    console.log(`[${tag}] ${f.message}`);
    if (f.level === "fail") fails += 1;
    if (f.level === "warn") warns += 1;
  }

  console.log(`\nSummary: fail=${fails} warn=${warns} ok=${findings.length - fails - warns}`);
  if (fails > 0) {
    process.exitCode = 1;
    console.log("PREFLIGHT FAILED");
  } else {
    console.log("PREFLIGHT PASSED");
  }
}

main();
