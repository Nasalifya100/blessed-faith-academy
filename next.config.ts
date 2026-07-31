import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION ??
      process.env.npm_package_version ??
      "0.1.0",
    NEXT_PUBLIC_GIT_SHA:
      process.env.NEXT_PUBLIC_GIT_SHA ?? process.env.GITHUB_SHA ?? "local",
    NEXT_PUBLIC_BUILD_TIMESTAMP:
      process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ??
      process.env.BUILD_TIMESTAMP ??
      "",
    NEXT_PUBLIC_DEPLOY_ENV:
      process.env.NEXT_PUBLIC_DEPLOY_ENV ?? process.env.DEPLOY_ENV ?? "local",
    NEXT_PUBLIC_WORKER_NAME:
      process.env.NEXT_PUBLIC_WORKER_NAME ?? "bfa-sms-staging",
  },
};

export default nextConfig;

// Enables Cloudflare bindings / OpenNext integration during `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
