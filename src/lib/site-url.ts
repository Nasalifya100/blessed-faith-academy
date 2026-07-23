/**
 * Canonical public site origin for Auth email redirects.
 *
 * Prefer an allowlisted request origin (staging vs local) when the admin
 * triggers a reset, then NEXT_PUBLIC_SITE_URL. Never fall back to localhost
 * in production builds.
 */

const BUILTIN_TRUSTED_HOSTS = new Set([
  "localhost:3000",
  "127.0.0.1:3000",
  "bfa-sms-staging.nasalifya007.workers.dev",
]);

function configuredSiteUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  return configured || null;
}

function hostFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** True when origin is localhost / 127.0.0.1 (any port). */
export function isLocalhostOrigin(origin: string): boolean {
  const host = hostFromOrigin(origin);
  if (!host) return false;
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:")
  );
}

/**
 * Origins allowed for password-reset redirectTo (host header injection guard).
 */
export function isTrustedPasswordResetOrigin(origin: string): boolean {
  const host = hostFromOrigin(origin);
  if (!host) return false;
  if (BUILTIN_TRUSTED_HOSTS.has(host)) return true;

  const configured = configuredSiteUrl();
  if (configured) {
    const configuredHost = hostFromOrigin(configured);
    if (configuredHost && configuredHost === host) return true;
  }
  return false;
}

/**
 * Resolve the public site origin.
 *
 * @param requestOrigin Optional `https://host` from the current request
 *   (x-forwarded-proto + host). Used only when allowlisted.
 * @param options.nodeEnv Optional NODE_ENV override (tests only).
 */
export function getSiteUrl(
  requestOrigin?: string | null,
  options?: { nodeEnv?: string },
): string {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const normalizedRequest = requestOrigin?.trim().replace(/\/$/, "") || null;

  if (normalizedRequest && isTrustedPasswordResetOrigin(normalizedRequest)) {
    if (nodeEnv === "production" && isLocalhostOrigin(normalizedRequest)) {
      // Production bundles must never emit localhost reset links.
    } else {
      return normalizedRequest;
    }
  }

  const configured = configuredSiteUrl();
  if (configured) {
    if (nodeEnv === "production" && isLocalhostOrigin(configured)) {
      throw new Error(
        "NEXT_PUBLIC_SITE_URL must not be localhost in production. Set it to the deployed site origin (e.g. https://bfa-sms-staging.nasalifya007.workers.dev).",
      );
    }
    return configured;
  }

  if (nodeEnv === "development") {
    return "http://localhost:3000";
  }

  throw new Error(
    "NEXT_PUBLIC_SITE_URL must be set for password-reset email redirects.",
  );
}

export function getPasswordResetRedirectUrl(
  requestOrigin?: string | null,
  options?: { nodeEnv?: string },
): string {
  return `${getSiteUrl(requestOrigin, options)}/auth/reset-password`;
}

/**
 * Build an origin from Forwarded headers when present.
 * Returns null if headers are incomplete or untrusted.
 */
export function originFromForwardedHeaders(input: {
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}): string | null {
  const host = (input.forwardedHost || input.host || "").split(",")[0]?.trim();
  if (!host) return null;

  let proto = (input.forwardedProto || "").split(",")[0]?.trim().toLowerCase();
  if (!proto) {
    proto = isLocalhostOrigin(`http://${host}`) ? "http" : "https";
  }
  if (proto !== "http" && proto !== "https") return null;

  const origin = `${proto}://${host}`;
  return isTrustedPasswordResetOrigin(origin) ? origin : null;
}

/** Reject open redirects: only same-origin relative paths under /auth or /login. */
export function safePostAuthPath(candidate: string | null | undefined): string {
  if (!candidate) return "/login";
  if (!candidate.startsWith("/")) return "/login";
  if (candidate.startsWith("//")) return "/login";
  if (candidate.includes("://")) return "/login";
  if (candidate.startsWith("/login") || candidate.startsWith("/auth/")) {
    return candidate;
  }
  return "/login";
}

/** User-facing copy for expired / denied recovery links. */
export const PASSWORD_RESET_LINK_INVALID_MESSAGE =
  "This password-reset link is invalid or has expired. Request a new link.";

/**
 * Map Supabase / URL error params to a safe user message.
 * Never echoes tokens or raw provider payloads beyond known codes.
 */
export function passwordResetLinkErrorMessage(input: {
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}): string | null {
  const code = (input.errorCode || "").toLowerCase();
  const error = (input.error || "").toLowerCase();
  const description = (input.errorDescription || "").toLowerCase();

  if (
    code === "otp_expired" ||
    error === "access_denied" ||
    description.includes("expired") ||
    description.includes("invalid")
  ) {
    return PASSWORD_RESET_LINK_INVALID_MESSAGE;
  }

  if (error || code) {
    return PASSWORD_RESET_LINK_INVALID_MESSAGE;
  }

  return null;
}
