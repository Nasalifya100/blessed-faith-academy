/**
 * Upload an OpenNext Worker version, then promote it to 100% live traffic.
 *
 * Why: `opennextjs-cloudflare upload` / `wrangler versions upload` creates a
 * Worker Version but does NOT route production traffic. Promotion requires:
 *   wrangler versions deploy <version-id>@100% --yes
 *
 * Exit non-zero if upload or promotion fails. Does not print secrets.
 *
 * Expects OpenNext build output already present (.open-next/) OR runs upload
 * which relies on a prior `opennextjs-cloudflare build` (see package.json).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WORKER_NAME = "bfa-sms-staging";
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    cwd: process.cwd(),
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return {
    status: result.status == null ? 1 : result.status,
    output: `${stdout}\n${stderr}`,
    error: result.error,
  };
}

function parseVersionId(output) {
  const labeled =
    output.match(/Worker Version ID[:\s]+([0-9a-f-]{36})/i) ||
    output.match(/Version ID[:\s]+([0-9a-f-]{36})/i) ||
    output.match(/Current Version ID[:\s]+([0-9a-f-]{36})/i);
  if (labeled?.[1]) return labeled[1].toLowerCase();

  const all = output.match(UUID_RE) || [];
  if (all.length === 0) return null;
  // Prefer the last UUID in the log (upload result is typically near the end).
  return all[all.length - 1].toLowerCase();
}

function writeGithubOutput(versionId) {
  const outFile = process.env.GITHUB_OUTPUT;
  if (!outFile) return;
  fs.appendFileSync(outFile, `version=${versionId}\n`, "utf8");
}

function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".open-next", "worker.js"))) {
    console.error(
      "Missing .open-next/worker.js — run `npm run cf:build` (or opennextjs-cloudflare build) first.",
    );
    process.exit(1);
  }

  console.log("Uploading Worker version (wrangler versions upload via OpenNext)...");
  const upload = run("npx", [
    "opennextjs-cloudflare",
    "upload",
    "--",
    "--keep-vars",
  ]);
  if (upload.error) {
    console.error(upload.error.message || upload.error);
    process.exit(1);
  }
  if (upload.status !== 0) {
    console.error("Worker version upload failed.");
    process.exit(upload.status);
  }

  const versionId = parseVersionId(upload.output);
  if (!versionId) {
    console.error(
      "Failed to parse Worker Version ID from upload output. Cannot promote traffic.",
    );
    process.exit(1);
  }

  console.log(`Uploaded Worker Version ID: ${versionId}`);
  writeGithubOutput(versionId);

  console.log(
    `Promoting ${versionId} to 100% live traffic on Worker ${WORKER_NAME}...`,
  );
  const message = `GitHub Actions promote ${versionId}`.slice(0, 100);
  const promote = run("npx", [
    "wrangler",
    "versions",
    "deploy",
    `${versionId}@100%`,
    "--name",
    WORKER_NAME,
    "--yes",
    "--message",
    message,
  ]);
  if (promote.error) {
    console.error(promote.error.message || promote.error);
    process.exit(1);
  }
  if (promote.status !== 0) {
    console.error(
      `Traffic promotion failed for ${versionId}. Live traffic was NOT updated.`,
    );
    process.exit(promote.status);
  }

  console.log(
    `Promoted Worker Version ${versionId} to 100% traffic on ${WORKER_NAME}.`,
  );
}

main();
