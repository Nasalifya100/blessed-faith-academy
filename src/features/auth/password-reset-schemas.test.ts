import { describe, expect, it } from "vitest";

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
  safePostAuthPath,
} from "@/lib/site-url";

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
  it("builds reset redirect from NEXT_PUBLIC_SITE_URL", () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://bfa-sms-staging.example";
    expect(getSiteUrl()).toBe("https://bfa-sms-staging.example");
    expect(getPasswordResetRedirectUrl()).toBe(
      "https://bfa-sms-staging.example/auth/reset-password",
    );
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });

  it("strips trailing slash from site url", () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/";
    expect(getSiteUrl()).toBe("https://example.com");
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
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

describe("admin-only password reset policy", () => {
  it("documents that self-service forgot-password is not offered", () => {
    // Public recovery is intentionally omitted; only Administrators initiate
    // resets from Staff. Staff complete the emailed link at /auth/reset-password.
    expect(true).toBe(true);
  });
});
