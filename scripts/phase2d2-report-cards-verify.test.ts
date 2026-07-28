import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const verify = require("./phase2d2-report-cards-verify.cjs") as {
  SYNTHETIC_UUID: string;
  PUBLIC_RPC_PROBES: Array<{
    name: string;
    args: Record<string, unknown>;
    allowEmptyArgs?: boolean;
  }>;
  CLASSIFICATION: Record<string, string>;
  classifyRpcProbeResult: (input: {
    name: string;
    args: Record<string, unknown> | unknown[];
    error?: { message?: string; code?: string } | null;
    code?: string;
  }) => {
    kind: string;
    passAsPublicPresence: boolean;
    passAsHelperRevoked: boolean;
    emptyArgsArityMismatch?: boolean;
    detail: string;
  };
  evaluatePublicRpcClassification: (c: {
    kind: string;
    passAsPublicPresence: boolean;
    emptyArgsArityMismatch?: boolean;
  }) => { ok: boolean; reason: string };
  evaluateHelperRevocationClassification: (c: {
    kind: string;
    passAsHelperRevoked: boolean;
  }) => { ok: boolean; reason: string };
  defaultProbePayloadsContainOnlySyntheticIds: () => boolean;
};

const { CLASSIFICATION } = verify;

describe("phase2d2-report-cards-verify classification", () => {
  it("1. empty-parameter arity mismatch is not treated as universal function absence", () => {
    const c = verify.classifyRpcProbeResult({
      name: "approve_report_card",
      args: {},
      error: {
        message:
          "Could not find the function public.approve_report_card without parameters in the schema cache",
      },
    });
    expect(c.emptyArgsArityMismatch).toBe(true);
    expect(c.kind).toBe(CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND);
    expect(c.passAsPublicPresence).toBe(false);
    const verdict = verify.evaluatePublicRpcClassification(c);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/empty-args/i);
  });

  it("2. correct-signature true missing error fails public presence", () => {
    const c = verify.classifyRpcProbeResult({
      name: "approve_report_card",
      args: {
        p_report_card_id: verify.SYNTHETIC_UUID,
        p_expected_revision: 1,
        p_render_payload: {},
        p_render_payload_checksum: "x",
        p_source_fingerprint: "y",
      },
      error: {
        message:
          "Could not find the function public.approve_report_card(...) in the schema cache",
        code: "PGRST202",
      },
    });
    expect(c.emptyArgsArityMismatch).toBeFalsy();
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(false);
  });

  it("3. expected not-found business error passes as function resolved", () => {
    const c = verify.classifyRpcProbeResult({
      name: "publish_report_card",
      args: {
        p_report_card_id: verify.SYNTHETIC_UUID,
        p_expected_revision: 1,
      },
      error: { message: "Report card not found." },
    });
    expect(c.kind).toBe(
      CLASSIFICATION.FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR,
    );
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(true);
  });

  it("4. expected authentication error passes as function resolved", () => {
    const c = verify.classifyRpcProbeResult({
      name: "generate_or_refresh_report_card_draft",
      args: verify.PUBLIC_RPC_PROBES.find(
        (p) => p.name === "generate_or_refresh_report_card_draft",
      )!.args,
      error: { message: "You must be signed in." },
    });
    expect(c.kind).toBe(CLASSIFICATION.AUTH_REQUIRED);
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(true);
  });

  it("5. stale/outdated business error passes as resolved", () => {
    const c = verify.classifyRpcProbeResult({
      name: "approve_report_card",
      args: verify.PUBLIC_RPC_PROBES.find((p) => p.name === "approve_report_card")!
        .args,
      error: {
        message: "Results are stale; recalculate before approval.",
      },
    });
    expect(c.passAsPublicPresence).toBe(true);
  });

  it("6. permission denied can classify as helper revocation", () => {
    const c = verify.classifyRpcProbeResult({
      name: "can_view_report_card",
      args: { p_report_card_id: verify.SYNTHETIC_UUID },
      error: { message: "permission denied for function can_view_report_card" },
    });
    expect(c.passAsHelperRevoked).toBe(true);
    expect(verify.evaluateHelperRevocationClassification(c).ok).toBe(true);
  });

  it("7. probe payloads use only the synthetic UUID", () => {
    expect(verify.defaultProbePayloadsContainOnlySyntheticIds()).toBe(true);
  });

  it("8. parameterized probes never use empty args objects", () => {
    for (const probe of verify.PUBLIC_RPC_PROBES) {
      if (probe.allowEmptyArgs) continue;
      expect(Object.keys(probe.args).length).toBeGreaterThan(0);
    }
  });
});
