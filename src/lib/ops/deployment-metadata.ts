/**
 * Safe deployment / build identity for support incidents.
 * Never includes secrets.
 */

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

export function getDeploymentMetadata(): DeploymentMetadata {
  const gitSha =
    readEnv("NEXT_PUBLIC_GIT_SHA") ??
    readEnv("GITHUB_SHA") ??
    readEnv("CF_PAGES_COMMIT_SHA") ??
    "unknown";

  const buildTimestamp =
    readEnv("NEXT_PUBLIC_BUILD_TIMESTAMP") ??
    readEnv("BUILD_TIMESTAMP") ??
    "unknown";

  const environmentName =
    readEnv("NEXT_PUBLIC_DEPLOY_ENV") ??
    readEnv("DEPLOY_ENV") ??
    "effective-production";

  const applicationVersion =
    readEnv("NEXT_PUBLIC_APP_VERSION") ??
    readEnv("npm_package_version") ??
    "0.1.0";

  const workerName = readEnv("NEXT_PUBLIC_WORKER_NAME") ?? DEFAULT_WORKER;

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
