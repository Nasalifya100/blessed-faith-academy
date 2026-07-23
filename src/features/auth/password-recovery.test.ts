import { describe, expect, it } from "vitest";

import {
  canPresentPasswordResetForm,
  canUpdatePasswordForSession,
  createRecoveryProof,
  hasRecoveryCredential,
  isRecoveryProofValidForUser,
  maskedRecoveryEmail,
  parseRecoveryProof,
  parseRecoveryUrlSignals,
  serializeRecoveryProof,
} from "@/features/auth/password-recovery";

describe("parseRecoveryUrlSignals", () => {
  it("detects PKCE code", () => {
    const signals = parseRecoveryUrlSignals(
      "https://app.example/auth/reset-password?code=abc123",
    );
    expect(signals.code).toBe("abc123");
    expect(hasRecoveryCredential(signals)).toBe(true);
  });

  it("detects token_hash recovery", () => {
    const signals = parseRecoveryUrlSignals(
      "https://app.example/auth/reset-password?token_hash=xyz&type=recovery",
    );
    expect(signals.tokenHash).toBe("xyz");
    expect(signals.otpType).toBe("recovery");
    expect(hasRecoveryCredential(signals)).toBe(true);
  });

  it("detects implicit recovery hash", () => {
    const signals = parseRecoveryUrlSignals(
      "https://app.example/auth/reset-password#access_token=tok&type=recovery",
    );
    expect(signals.hasRecoveryHash).toBe(true);
    expect(hasRecoveryCredential(signals)).toBe(true);
  });

  it("treats bare reset URL as having no recovery credential", () => {
    const signals = parseRecoveryUrlSignals(
      "https://app.example/auth/reset-password",
    );
    expect(hasRecoveryCredential(signals)).toBe(false);
  });
});

describe("recovery proof", () => {
  it("round-trips serialization", () => {
    const proof = createRecoveryProof({
      userId: "user-1",
      email: "Staff@School.EDU",
      now: 1_000_000,
    });
    expect(proof.email).toBe("staff@school.edu");
    const again = parseRecoveryProof(serializeRecoveryProof(proof));
    expect(again).toEqual(proof);
  });

  it("rejects proof for a different user", () => {
    const proof = createRecoveryProof({
      userId: "staff-id",
      email: "staff@school.edu",
      now: Date.now(),
    });
    expect(isRecoveryProofValidForUser(proof, "admin-id")).toBe(false);
    expect(isRecoveryProofValidForUser(proof, "staff-id")).toBe(true);
  });

  it("rejects expired proof", () => {
    const proof = createRecoveryProof({
      userId: "staff-id",
      email: "staff@school.edu",
      now: Date.now() - 3 * 60 * 60 * 1000,
    });
    expect(isRecoveryProofValidForUser(proof, "staff-id")).toBe(false);
  });
});

describe("canPresentPasswordResetForm", () => {
  const emptySignals = parseRecoveryUrlSignals(
    "https://app.example/auth/reset-password",
  );

  it("rejects an ordinary authenticated admin session without recovery proof", () => {
    const result = canPresentPasswordResetForm({
      urlSignals: emptySignals,
      sessionUserId: "admin-id",
      recoveryProof: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("stale_session_not_recovery");
    }
  });

  it("allows a matching recovery proof after credentials were consumed", () => {
    const proof = createRecoveryProof({
      userId: "staff-id",
      email: "staff@school.edu",
      now: Date.now(),
    });
    const result = canPresentPasswordResetForm({
      urlSignals: emptySignals,
      sessionUserId: "staff-id",
      recoveryProof: proof,
    });
    expect(result).toEqual({ ok: true, userId: "staff-id" });
  });

  it("rejects mismatched session vs recovery proof", () => {
    const proof = createRecoveryProof({
      userId: "staff-id",
      email: "staff@school.edu",
      now: Date.now(),
    });
    const result = canPresentPasswordResetForm({
      urlSignals: emptySignals,
      sessionUserId: "admin-id",
      recoveryProof: proof,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_user_mismatch");
    }
  });
});

describe("canUpdatePasswordForSession", () => {
  it("blocks updateUser when only a normal session exists", () => {
    const result = canUpdatePasswordForSession({
      sessionUserId: "admin-id",
      recoveryProof: null,
    });
    expect(result.ok).toBe(false);
  });

  it("allows updateUser only for the recovery target user", () => {
    const proof = createRecoveryProof({
      userId: "staff-id",
      email: "staff@school.edu",
      now: Date.now(),
    });
    expect(
      canUpdatePasswordForSession({
        sessionUserId: "staff-id",
        recoveryProof: proof,
      }).ok,
    ).toBe(true);
    expect(
      canUpdatePasswordForSession({
        sessionUserId: "admin-id",
        recoveryProof: proof,
      }).ok,
    ).toBe(false);
  });
});

describe("maskedRecoveryEmail", () => {
  it("masks without revealing the full address", () => {
    expect(maskedRecoveryEmail("teacher@school.edu")).toBe("t***r@school.edu");
  });
});
