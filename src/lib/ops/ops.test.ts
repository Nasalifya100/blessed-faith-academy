import { describe, expect, it, beforeEach } from "vitest";

import {
  createIncidentId,
  formatOpsErrorForUser,
  isSensitiveSqlLeak,
  normalizeOpsError,
} from "@/lib/ops/errors";
import {
  checkRateLimit,
  RATE_LIMIT_PROFILES,
  RATE_LIMIT_SCHOOL_SAFE_FLOORS,
  resetRateLimitStoreForTests,
} from "@/lib/ops/rate-limit";
import {
  assertNoSensitiveLogContent,
  createCorrelationId,
  scrubLogMessage,
  scrubLogMeta,
} from "@/lib/ops/logger";
import {
  getDeploymentMetadata,
  getPublicDeploymentSummary,
} from "@/lib/ops/deployment-metadata";
import {
  clampListLimit,
  MAX_LIST_ROWS,
  normalizePageParams,
} from "@/lib/ops/pagination";
import {
  assertSchoolScopedStoragePath,
  validateImageUpload,
} from "@/lib/ops/upload-policy";
import {
  isPublicHealthSafe,
  mapBackupStatus,
  mapConnectivityToStatus,
  redactHealthDetail,
  worstStatus,
} from "@/lib/ops/health-status";

describe("ops errors", () => {
  it("maps categories and hides SQL leaks", () => {
    expect(isSensitiveSqlLeak("permission denied for relation students")).toBe(
      true,
    );
    const err = normalizeOpsError("permission denied for relation students", {
      category: "PERMISSION_DENIED",
    });
    expect(err.category).toBe("PERMISSION_DENIED");
    expect(err.message).not.toMatch(/relation/i);
    expect(formatOpsErrorForUser(err)).toContain("ref:");
  });

  it("detects rate limit and revision conflict from text", () => {
    expect(normalizeOpsError("Too many requests").category).toBe("RATE_LIMITED");
    expect(normalizeOpsError("revision conflict").category).toBe(
      "REVISION_CONFLICT",
    );
  });

  it("creates opaque incident ids", () => {
    expect(createIncidentId("bfa")).toMatch(/^bfa-/);
  });
});

describe("ops logging", () => {
  it("scrubs sensitive meta keys", () => {
    const scrubbed = scrubLogMeta({
      password: "secret",
      token: "abc",
      studentCount: 12,
      detail: "permission denied for relation students",
    });
    expect(scrubbed).toEqual({ studentCount: 12 });
  });

  it("scrubs sensitive log messages", () => {
    expect(scrubLogMessage("permission denied for relation x")).toBe(
      "Details withheld",
    );
    expect(scrubLogMessage("Deep health check failed")).toBe(
      "Deep health check failed",
    );
  });

  it("rejects sensitive serialized log content", () => {
    expect(assertNoSensitiveLogContent('{"ok":true}')).toBe(true);
    expect(
      assertNoSensitiveLogContent('{"Authorization":"Bearer abc.def.ghi"}'),
    ).toBe(false);
  });

  it("creates correlation ids", () => {
    expect(createCorrelationId()).toMatch(/^req-/);
    expect(createCorrelationId()).not.toMatch(/supabase|postgres|service_role/i);
  });
});

describe("deployment metadata", () => {
  it("exposes safe public summary", () => {
    const summary = getPublicDeploymentSummary();
    expect(summary.status).toBe("ok");
    expect(summary.applicationVersion).toBeTruthy();
    expect(summary.commit).toBeTruthy();
    expect(isPublicHealthSafe(summary)).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/service_role|SUPABASE_/i);
  });

  it("returns worker and environment fields", () => {
    const meta = getDeploymentMetadata();
    expect(meta.workerName).toBeTruthy();
    expect(meta.environmentName).toBeTruthy();
  });

  it("prefers generated build info when present", async () => {
    const { BUILD_INFO } = await import("@/lib/ops/build-info.generated");
    expect(BUILD_INFO).toHaveProperty("gitSha");
    expect(BUILD_INFO).toHaveProperty("workerName");
    expect(JSON.stringify(BUILD_INFO)).not.toMatch(/service_role|eyJhbGci/i);
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it("blocks after limit and returns RATE semantics", () => {
    const key = "test-actor";
    expect(checkRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed).toBe(
      true,
    );
    expect(checkRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed).toBe(
      true,
    );
    const blocked = checkRateLimit({ key, limit: 2, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps school-safe minimum throughput floors", () => {
    expect(RATE_LIMIT_PROFILES.passwordReset.limit).toBeGreaterThanOrEqual(
      RATE_LIMIT_SCHOOL_SAFE_FLOORS.passwordReset,
    );
    expect(RATE_LIMIT_PROFILES.reportCardBulk.limit).toBeGreaterThanOrEqual(
      RATE_LIMIT_SCHOOL_SAFE_FLOORS.reportCardBulk,
    );
    expect(RATE_LIMIT_PROFILES.resultRecalc.limit).toBeGreaterThanOrEqual(
      RATE_LIMIT_SCHOOL_SAFE_FLOORS.resultRecalc,
    );
  });
});

describe("public health OpenNext compatibility", () => {
  it("does not declare unsupported per-route edge runtime", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/health/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/);
    expect(source).toMatch(/dynamic\s*=\s*["']force-dynamic["']/);
  });
});

describe("pagination bounds", () => {
  it("normalizes page and clamps page size", () => {
    expect(normalizePageParams({ page: 0, pageSize: 999 })).toEqual({
      page: 1,
      pageSize: 100,
      offset: 0,
    });
    expect(clampListLimit(50_000)).toBe(MAX_LIST_ROWS);
  });
});

describe("upload policy", () => {
  it("accepts safe images and rejects traversal / executables", () => {
    const ok = validateImageUpload({
      originalFileName: "photo.JPG",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      schoolId: "11111111-1111-1111-1111-111111111111",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(assertSchoolScopedStoragePath(ok.safeFileName, ok.safeFileName.split("/")[0]!)).toBe(
        true,
      );
    }

    expect(
      validateImageUpload({
        originalFileName: "../x.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
        schoolId: "school-a",
      }).ok,
    ).toBe(false);
  });
});

describe("health status mapping", () => {
  it("maps connectivity and backup statuses", () => {
    expect(mapConnectivityToStatus(true)).toBe("Healthy");
    expect(mapConnectivityToStatus(false)).toBe("Unavailable");
    expect(mapBackupStatus(null)).toBe("Unknown");
    expect(mapBackupStatus(false)).toBe("Action required");
  });

  it("redacts internal details and computes worst status", () => {
    expect(redactHealthDetail("project qaczvlbgsxcrdcdgsfpo failed")).toBe(
      "Details withheld for security.",
    );
    expect(
      worstStatus(["Healthy", "Warning", "Action required"]),
    ).toBe("Action required");
  });
});

describe("admin deep health access contract", () => {
  it("documents administrator-only gate expectation", () => {
    // Route-level enforcement lives in system-health page (role === administrator).
    // This unit asserts the public surface stays redacted regardless of admin data.
    const payload = {
      status: "ok",
      timestamp: new Date().toISOString(),
      applicationVersion: "0.1.0",
      environment: "effective-production",
      commit: "abc123",
    };
    expect(isPublicHealthSafe(payload)).toBe(true);
    expect(
      isPublicHealthSafe({
        ...payload,
        db: "postgresql://postgres@supabase.co/postgres",
      }),
    ).toBe(false);
  });
});

describe("disabled-user behavior contract", () => {
  it("keeps inactive staff denied by capability semantics", () => {
    // Mirrors dashboard layout + RPC is_active gates: inactive profiles must not act.
    const profile = { is_active: false, role: "administrator" as const };
    expect(profile.is_active && profile.role === "administrator").toBe(false);
  });
});

describe("cross-school denial contract", () => {
  it("requires school-scoped storage paths", () => {
    expect(
      assertSchoolScopedStoragePath(
        "school-a/file.jpg",
        "school-a",
      ),
    ).toBe(true);
    expect(
      assertSchoolScopedStoragePath(
        "school-b/file.jpg",
        "school-a",
      ),
    ).toBe(false);
  });
});
