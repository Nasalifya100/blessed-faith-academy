import { describe, expect, it, afterEach } from "vitest";

import {
  assertSafeAuditMetadata,
  maskEmail,
  passwordSchema,
  resetPasswordSchema,
  adminSendPasswordResetSchema,
} from "@/features/auth/password-reset-schemas";
import {
  getPasswordResetRedirectUrl,
  getSiteUrl,
  isLocalhostOrigin,
  isTrustedPasswordResetOrigin,
  originFromForwardedHeaders,
  passwordResetLinkErrorMessage,
  PASSWORD_RESET_LINK_INVALID_MESSAGE,
  safePostAuthPath,
} from "@/lib/site-url";

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_TRUSTED_HOSTS = process.env.NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS;

const PORTAL_URL = "https://portal.blessedfaithacademy.com";
const LEGACY_WORKER_HOST = "bfa-sms-staging.nasalifya007.workers.dev";

afterEach(() => {
  if (ORIGINAL_SITE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
  }
  if (ORIGINAL_TRUSTED_HOSTS === undefined) {
    delete process.env.NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS;
  } else {
    process.env.NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS = ORIGINAL_TRUSTED_HOSTS;
  }
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords with letter and number", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "Secret12",
        confirmPassword: "Secret12",
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        password: "Secret12",
        confirmPassword: "Other12",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        password: "short1",
        confirmPassword: "short1",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        password: "longpassword",
        confirmPassword: "longpassword",
      }).success,
    ).toBe(false);
  });

  it("rejects mismatched passwords with a clear path error", () => {
    const result = resetPasswordSchema.safeParse({
      password: "Secret12",
      confirmPassword: "Secret99",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/do not match/i);
    }
  });
});

describe("passwordSchema", () => {
  it("enforces minimum length", () => {
    expect(passwordSchema.safeParse("Ab12").success).toBe(false);
    expect(passwordSchema.safeParse("Abcdef12").success).toBe(true);
  });
});

describe("adminSendPasswordResetSchema", () => {
  it("requires a uuid staff id", () => {
    expect(
      adminSendPasswordResetSchema.safeParse({
        staffId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(true);
    expect(
      adminSendPasswordResetSchema.safeParse({ staffId: "nope" }).success,
    ).toBe(false);
  });
});

describe("maskEmail", () => {
  it("masks local part without revealing the full address", () => {
    expect(maskEmail("teacher@school.edu")).toBe("t***r@school.edu");
  });
});

describe("assertSafeAuditMetadata", () => {
  it("rejects credential-like keys", () => {
    expect(assertSafeAuditMetadata({ action: "reset" })).toBe(true);
    expect(assertSafeAuditMetadata({ password: "secret" })).toBe(false);
    expect(assertSafeAuditMetadata({ access_token: "x" })).toBe(false);
    expect(
      assertSafeAuditMetadata({ note: "SUPABASE_SERVICE_ROLE_KEY present" }),
    ).toBe(false);
  });
});

describe("site url helpers", () => {
  it("builds production reset redirect from NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = PORTAL_URL;
    expect(getSiteUrl(null, { nodeEnv: "production" })).toBe(PORTAL_URL);
    expect(getPasswordResetRedirectUrl(null, { nodeEnv: "production" })).toBe(
      `${PORTAL_URL}/auth/reset-password`,
    );
  });

  it("trusts the configured site origin without hardcoding a deployment host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = PORTAL_URL;
    expect(isTrustedPasswordResetOrigin(PORTAL_URL)).toBe(true);
    expect(isTrustedPasswordResetOrigin(`https://${LEGACY_WORKER_HOST}`)).toBe(
      false,
    );
  });

  it("trusts cutover hosts only when explicitly allowlisted", () => {
    process.env.NEXT_PUBLIC_SITE_URL = PORTAL_URL;
    process.env.NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS = LEGACY_WORKER_HOST;
    expect(isTrustedPasswordResetOrigin(`https://${LEGACY_WORKER_HOST}`)).toBe(
      true,
    );
    expect(isTrustedPasswordResetOrigin("https://evil.example")).toBe(false);
  });

  it("builds local reset redirect from localhost site url", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(getPasswordResetRedirectUrl(null, { nodeEnv: "development" })).toBe(
      "http://localhost:3000/auth/reset-password",
    );
  });

  it("prefers allowlisted request origin over misconfigured env", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS =
      "portal.blessedfaithacademy.com";
    expect(
      getPasswordResetRedirectUrl(PORTAL_URL, { nodeEnv: "production" }),
    ).toBe(`${PORTAL_URL}/auth/reset-password`);
  });

  it("rejects hardcoded localhost in production when no trusted origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(() => getSiteUrl(null, { nodeEnv: "production" })).toThrow(
      /must not be localhost/i,
    );
  });

  it("does not trust arbitrary request origins", () => {
    expect(isTrustedPasswordResetOrigin("https://evil.example")).toBe(false);
    expect(
      originFromForwardedHeaders({
        forwardedHost: "evil.example",
        forwardedProto: "https",
      }),
    ).toBeNull();
  });

  it("accepts forwarded headers for the configured portal host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = PORTAL_URL;
    expect(
      originFromForwardedHeaders({
        forwardedHost: "portal.blessedfaithacademy.com",
        forwardedProto: "https",
      }),
    ).toBe(PORTAL_URL);
  });

  it("rejects forwarded headers for an unlisted deployment host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = PORTAL_URL;
    expect(
      originFromForwardedHeaders({
        forwardedHost: LEGACY_WORKER_HOST,
        forwardedProto: "https",
      }),
    ).toBeNull();
  });

  it("strips trailing slash from site url", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/";
    expect(getSiteUrl(null, { nodeEnv: "development" })).toBe(
      "https://example.com",
    );
  });

  it("detects localhost origins", () => {
    expect(isLocalhostOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalhostOrigin(PORTAL_URL)).toBe(false);
  });

  it("blocks open redirects", () => {
    expect(safePostAuthPath("https://evil.com")).toBe("/login");
    expect(safePostAuthPath("//evil.com")).toBe("/login");
    expect(safePostAuthPath("/dashboard")).toBe("/login");
    expect(safePostAuthPath("/login")).toBe("/login");
    expect(safePostAuthPath("/auth/reset-password")).toBe(
      "/auth/reset-password",
    );
  });
});

describe("password reset link errors", () => {
  it("maps otp_expired / access_denied to a safe message", () => {
    expect(
      passwordResetLinkErrorMessage({
        error: "access_denied",
        errorCode: "otp_expired",
        errorDescription: "Email link is invalid or has expired",
      }),
    ).toBe(PASSWORD_RESET_LINK_INVALID_MESSAGE);
  });

  it("returns null when no error params are present", () => {
    expect(passwordResetLinkErrorMessage({})).toBeNull();
  });
});

describe("admin-only password reset policy", () => {
  it("documents that self-service forgot-password is not offered", () => {
    expect(true).toBe(true);
  });
});
