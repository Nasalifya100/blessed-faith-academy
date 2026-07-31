/**
 * Safe deployment / build identity for support incidents.
 * Never includes secrets.
 *
 * Prefers compile-time BUILD_INFO (generated before OpenNext build) because
 * Cloudflare Worker runtime does not reliably expose CI NEXT_PUBLIC_* vars.
 */

import { BUILD_INFO } from "@/lib/ops/build-info.generated";

export type DeploymentMetadata = {
  applicationVersion: string;
  gitSha: string;
  gitShaShort: string;
  buildTimestamp: string;
  environmentName: string;
  workerName: string;
};

const DEFAULT_WORKER = "bfa-sms-staging";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) return undefined;
  return value.trim();
}

function prefer(
  generated: string | undefined,
  ...envNames: string[]
): string | undefined {
  if (generated && generated !== "unknown" && generated !== "local") {
    return generated;
  }
  for (const name of envNames) {
    const value = readEnv(name);
    if (value) return value;
  }
  if (generated && generated.trim()) return generated;
  return undefined;
}

export function getDeploymentMetadata(): DeploymentMetadata {
  const gitSha =
    prefer(
      BUILD_INFO.gitSha,
      "NEXT_PUBLIC_GIT_SHA",
      "GITHUB_SHA",
      "CF_PAGES_COMMIT_SHA",
    ) ?? "unknown";

  const buildTimestamp =
    prefer(
      BUILD_INFO.buildTimestamp,
      "NEXT_PUBLIC_BUILD_TIMESTAMP",
      "BUILD_TIMESTAMP",
    ) ?? "unknown";

  const environmentName =
    prefer(BUILD_INFO.environmentName, "NEXT_PUBLIC_DEPLOY_ENV", "DEPLOY_ENV") ??
    "effective-production";

  const applicationVersion =
    prefer(
      BUILD_INFO.applicationVersion,
      "NEXT_PUBLIC_APP_VERSION",
      "npm_package_version",
    ) ?? "0.1.0";

  const workerName =
    prefer(BUILD_INFO.workerName, "NEXT_PUBLIC_WORKER_NAME") ?? DEFAULT_WORKER;

  return {
    applicationVersion,
    gitSha,
    gitShaShort: gitSha === "unknown" ? "unknown" : gitSha.slice(0, 12),
    buildTimestamp,
    environmentName,
    workerName,
  };
}

/** Public health payload — no internals. */
export function getPublicDeploymentSummary(): {
  status: "ok";
  timestamp: string;
  applicationVersion: string;
  environment: string;
  commit: string;
} {
  const meta = getDeploymentMetadata();
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    applicationVersion: meta.applicationVersion,
    environment: meta.environmentName,
    commit: meta.gitShaShort,
  };
}
