import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  canRunProductionReset,
  isProductionResetEnvEnabled,
} from "@/features/auth/permissions";
import {
  PRODUCTION_RESET_CONFIRMATION,
  PRODUCTION_RESET_SCHOOL_NAME,
  isValidProductionResetConfirmation,
  productionResetConfirmSchema,
} from "@/features/system/production-reset-schemas";

describe("canRunProductionReset", () => {
  it("allows only administrator", () => {
    expect(canRunProductionReset("administrator")).toBe(true);
    expect(canRunProductionReset("headteacher")).toBe(false);
    expect(canRunProductionReset("bursar")).toBe(false);
    expect(canRunProductionReset("secretary")).toBe(false);
    expect(canRunProductionReset(null)).toBe(false);
  });
});

describe("isProductionResetEnvEnabled", () => {
  const original = process.env.ALLOW_PRODUCTION_RESET;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ALLOW_PRODUCTION_RESET;
    } else {
      process.env.ALLOW_PRODUCTION_RESET = original;
    }
  });

  it("is blocked when unset or false", () => {
    delete process.env.ALLOW_PRODUCTION_RESET;
    expect(isProductionResetEnvEnabled()).toBe(false);
    process.env.ALLOW_PRODUCTION_RESET = "false";
    expect(isProductionResetEnvEnabled()).toBe(false);
  });

  it("is enabled only when exactly true", () => {
    process.env.ALLOW_PRODUCTION_RESET = "true";
    expect(isProductionResetEnvEnabled()).toBe(true);
    process.env.ALLOW_PRODUCTION_RESET = "TRUE";
    expect(isProductionResetEnvEnabled()).toBe(false);
  });
});

describe("productionResetConfirmSchema", () => {
  it("accepts exact school name and confirmation with understood", () => {
    const parsed = productionResetConfirmSchema.safeParse({
      schoolName: PRODUCTION_RESET_SCHOOL_NAME,
      confirmation: PRODUCTION_RESET_CONFIRMATION,
      understood: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects incorrect confirmation phrase", () => {
    const parsed = productionResetConfirmSchema.safeParse({
      schoolName: PRODUCTION_RESET_SCHOOL_NAME,
      confirmation: "RESET",
      understood: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects incorrect school name", () => {
    const parsed = productionResetConfirmSchema.safeParse({
      schoolName: "Other School",
      confirmation: PRODUCTION_RESET_CONFIRMATION,
      understood: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects when not understood", () => {
    const parsed = productionResetConfirmSchema.safeParse({
      schoolName: PRODUCTION_RESET_SCHOOL_NAME,
      confirmation: PRODUCTION_RESET_CONFIRMATION,
      understood: false,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("isValidProductionResetConfirmation", () => {
  it("requires both phrases exactly", () => {
    expect(
      isValidProductionResetConfirmation(
        PRODUCTION_RESET_SCHOOL_NAME,
        PRODUCTION_RESET_CONFIRMATION,
      ),
    ).toBe(true);
    expect(
      isValidProductionResetConfirmation(
        "blessed faith academy",
        PRODUCTION_RESET_CONFIRMATION,
      ),
    ).toBe(false);
  });
});

describe("dry-run vs execute mode contract", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_PRODUCTION_RESET", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("documents that dry-run is the default app path when flag is off (blocked)", () => {
    expect(isProductionResetEnvEnabled()).toBe(false);
  });
});
