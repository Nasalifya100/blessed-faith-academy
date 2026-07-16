import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Minimal OpenNext Cloudflare config for staging.
 * R2 incremental cache can be added later if ISR/caching is needed.
 */
export default defineCloudflareConfig();
