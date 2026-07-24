import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const verify = require("./phase2c-stage1-verify.cjs") as {
  SYNTHETIC_UUID: string;
  PUBLIC_RPC_PROBES: Array<{ name: string; args: Record<string, unknown> }>;
  INTERNAL_HELPERS: Array<{ name: string; args: Record<string, unknown> }>;
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

describe("phase2c-stage1-verify classification", () => {
  it("1. empty-parameter arity mismatch is not treated as universal function absence", () => {
    const c = verify.classifyRpcProbeResult({
      name: "open_or_get_exam_gradebook",
      args: {},
      error: {
        message:
          "Could not find the function public.open_or_get_exam_gradebook without parameters in the schema cache",
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
      name: "open_or_get_exam_gradebook",
      args: {
        p_exam_id: verify.SYNTHETIC_UUID,
        p_class_id: verify.SYNTHETIC_UUID,
      },
      error: {
        message:
          "Could not find the function public.open_or_get_exam_gradebook(p_exam_id, p_class_id) in the schema cache",
        code: "PGRST202",
      },
    });
    expect(c.emptyArgsArityMismatch).toBeFalsy();
    expect(c.kind).toBe(CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND);
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(false);
  });

  it("3. expected UUID / not-found business error passes as function resolved", () => {
    const c = verify.classifyRpcProbeResult({
      name: "get_exam_gradebook",
      args: { p_gradebook_id: verify.SYNTHETIC_UUID },
      error: { message: "Gradebook not found." },
    });
    expect(c.kind).toBe(
      CLASSIFICATION.FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR,
    );
    expect(c.passAsPublicPresence).toBe(true);
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(true);
  });

  it("4. expected authentication error passes as function resolved", () => {
    const c = verify.classifyRpcProbeResult({
      name: "save_exam_gradebook_draft",
      args: {
        p_gradebook_id: verify.SYNTHETIC_UUID,
        p_expected_revision: 1,
        p_rows: [],
      },
      error: { message: "You must be signed in." },
    });
    expect(c.kind).toBe(CLASSIFICATION.AUTH_REQUIRED);
    expect(c.passAsPublicPresence).toBe(true);
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(true);
  });

  it("5. expected authorization / not-found error passes as function resolved", () => {
    const c = verify.classifyRpcProbeResult({
      name: "open_or_get_exam_gradebook",
      args: {
        p_exam_id: verify.SYNTHETIC_UUID,
        p_class_id: verify.SYNTHETIC_UUID,
      },
      error: { message: "You are not authorized to open this gradebook." },
    });
    expect(c.kind).toBe(
      CLASSIFICATION.FUNCTION_RESOLVED_EXPECTED_BUSINESS_ERROR,
    );
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(true);
  });

  it("6. internal helper permission denied / schema hide is expected security", () => {
    const denied = verify.classifyRpcProbeResult({
      name: "can_enter_exam_gradebook",
      args: {
        p_exam_id: verify.SYNTHETIC_UUID,
        p_class_id: verify.SYNTHETIC_UUID,
      },
      error: { message: "permission denied for function can_enter_exam_gradebook" },
    });
    expect(denied.kind).toBe(
      CLASSIFICATION.PERMISSION_DENIED_EXPECTED_FOR_INTERNAL_HELPER,
    );
    expect(denied.passAsHelperRevoked).toBe(true);
    expect(verify.evaluateHelperRevocationClassification(denied).ok).toBe(true);

    const hidden = verify.classifyRpcProbeResult({
      name: "exam_allows_marks_entry",
      args: { p_exam_id: verify.SYNTHETIC_UUID },
      error: {
        message:
          "Could not find the function public.exam_allows_marks_entry(p_exam_id) in the schema cache",
        code: "PGRST202",
      },
    });
    expect(hidden.passAsHelperRevoked).toBe(true);
    expect(verify.evaluateHelperRevocationClassification(hidden).ok).toBe(true);
  });

  it("7. unexpected database error fails", () => {
    const c = verify.classifyRpcProbeResult({
      name: "lock_exam_gradebook",
      args: {
        p_gradebook_id: verify.SYNTHETIC_UUID,
        p_expected_revision: 1,
      },
      error: { message: "relation public.exam_gradebooks does not exist" },
    });
    expect(c.kind).toBe(CLASSIFICATION.UNEXPECTED_ERROR);
    expect(verify.evaluatePublicRpcClassification(c).ok).toBe(false);
  });

  it("8. schema-cache transient error does not falsely pass as confirmed presence", () => {
    const c = verify.classifyRpcProbeResult({
      name: "submit_exam_gradebook",
      args: {
        p_gradebook_id: verify.SYNTHETIC_UUID,
        p_expected_revision: 1,
      },
      error: { message: "Could not refresh the schema cache" },
    });
    expect(c.kind).toBe(CLASSIFICATION.SCHEMA_CACHE_OR_TRANSIENT_ERROR);
    expect(c.passAsPublicPresence).toBe(false);
    const verdict = verify.evaluatePublicRpcClassification(c);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/transient|schema-cache/i);
  });

  it("9. output helpers: failures set non-ok verdicts; success path is ok", () => {
    const authOk = verify.evaluatePublicRpcClassification({
      kind: CLASSIFICATION.AUTH_REQUIRED,
      passAsPublicPresence: true,
    });
    expect(authOk.ok).toBe(true);

    const missing = verify.evaluatePublicRpcClassification({
      kind: CLASSIFICATION.FUNCTION_SIGNATURE_NOT_FOUND,
      passAsPublicPresence: false,
    });
    expect(missing.ok).toBe(false);

    const helperExecutable = verify.evaluateHelperRevocationClassification({
      kind: CLASSIFICATION.RESOLVED_OK,
      passAsHelperRevoked: false,
    });
    expect(helperExecutable.ok).toBe(false);
  });

  it("10. default mutation probe payloads contain only the synthetic UUID", () => {
    expect(verify.defaultProbePayloadsContainOnlySyntheticIds()).toBe(true);
    const all = JSON.stringify({
      public: verify.PUBLIC_RPC_PROBES,
      helpers: verify.INTERNAL_HELPERS.map((h) => ({
        name: h.name,
        args: h.args,
      })),
    });
    const uuids = all.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    );
    expect(uuids?.length).toBeGreaterThan(0);
    expect(
      uuids?.every((u) => u.toLowerCase() === verify.SYNTHETIC_UUID),
    ).toBe(true);
  });
});
