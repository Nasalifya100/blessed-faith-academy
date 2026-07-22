/**
 * Canonical public site origin for Auth email redirects.
 *
 * Prefer NEXT_PUBLIC_SITE_URL (no trailing slash). Falls back to localhost
 * only in development so production never silently uses localhost.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  throw new Error(
    "NEXT_PUBLIC_SITE_URL must be set for password-reset email redirects.",
  );
}

export function getPasswordResetRedirectUrl(): string {
  return `${getSiteUrl()}/auth/reset-password`;
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
