/**
 * Password-recovery session gate (pure helpers).
 *
 * A normal authenticated session is NEVER sufficient to change a password
 * on the reset page. Only a session established from a recovery link
 * (PKCE code, token_hash OTP, or PASSWORD_RECOVERY) may proceed.
 */

import { maskEmail } from "@/features/auth/password-reset-schemas";

export const PASSWORD_RECOVERY_STORAGE_KEY = "bfa_pw_recovery_v1";

export type PasswordRecoveryProof = {
  userId: string;
  email: string;
  /** Epoch ms when recovery session was established in this browser tab. */
  establishedAt: number;
};

export type RecoveryUrlSignals = {
  code: string | null;
  tokenHash: string | null;
  otpType: string | null;
  hasRecoveryHash: boolean;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

export function parseRecoveryUrlSignals(href: string): RecoveryUrlSignals {
  const url = new URL(href);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);

  return {
    code: url.searchParams.get("code"),
    tokenHash: url.searchParams.get("token_hash"),
    otpType: url.searchParams.get("type"),
    hasRecoveryHash:
      hashParams.has("access_token") ||
      hashParams.get("type") === "recovery" ||
      url.hash.includes("type=recovery"),
    error: url.searchParams.get("error"),
    errorCode: url.searchParams.get("error_code"),
    errorDescription: url.searchParams.get("error_description"),
  };
}

/** True when the URL carries a recovery credential to consume. */
export function hasRecoveryCredential(signals: RecoveryUrlSignals): boolean {
  if (signals.code) return true;
  if (signals.tokenHash && signals.otpType === "recovery") return true;
  if (signals.hasRecoveryHash) return true;
  return false;
}

export function createRecoveryProof(input: {
  userId: string;
  email: string | null | undefined;
  now?: number;
}): PasswordRecoveryProof {
  return {
    userId: input.userId,
    email: (input.email ?? "").trim().toLowerCase(),
    establishedAt: input.now ?? Date.now(),
  };
}

export function serializeRecoveryProof(proof: PasswordRecoveryProof): string {
  return JSON.stringify(proof);
}

export function parseRecoveryProof(
  raw: string | null | undefined,
): PasswordRecoveryProof | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PasswordRecoveryProof>;
    if (
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      typeof parsed.email !== "string" ||
      typeof parsed.establishedAt !== "number"
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      email: parsed.email,
      establishedAt: parsed.establishedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Proof is valid only if it matches the active user and is fresh enough
 * for a single reset attempt in this tab (2 hours).
 */
export function isRecoveryProofValidForUser(
  proof: PasswordRecoveryProof | null,
  userId: string | null | undefined,
  now = Date.now(),
  maxAgeMs = 2 * 60 * 60 * 1000,
): boolean {
  if (!proof || !userId) return false;
  if (proof.userId !== userId) return false;
  if (now - proof.establishedAt > maxAgeMs) return false;
  if (now < proof.establishedAt - 60_000) return false;
  return true;
}

/**
 * Decide whether the reset form may be shown.
 * Existing sessions without recovery proof are rejected.
 */
export function canPresentPasswordResetForm(input: {
  urlSignals: RecoveryUrlSignals;
  /** Session user id AFTER consuming recovery credentials (if any). */
  sessionUserId: string | null;
  recoveryProof: PasswordRecoveryProof | null;
}): { ok: true; userId: string } | { ok: false; reason: string } {
  if (hasRecoveryCredential(input.urlSignals)) {
    // Caller must consume credentials first; if we still only have a stale
    // session user without proof, reject.
    if (
      input.sessionUserId &&
      isRecoveryProofValidForUser(input.recoveryProof, input.sessionUserId)
    ) {
      return { ok: true, userId: input.sessionUserId };
    }
    return {
      ok: false,
      reason: "recovery_not_established",
    };
  }

  if (
    input.sessionUserId &&
    isRecoveryProofValidForUser(input.recoveryProof, input.sessionUserId)
  ) {
    return { ok: true, userId: input.sessionUserId };
  }

  if (input.sessionUserId && !input.recoveryProof) {
    return { ok: false, reason: "stale_session_not_recovery" };
  }

  if (
    input.sessionUserId &&
    input.recoveryProof &&
    input.recoveryProof.userId !== input.sessionUserId
  ) {
    return { ok: false, reason: "session_user_mismatch" };
  }

  return { ok: false, reason: "missing_recovery" };
}

/** Gate for updateUser — must match recovery proof. */
export function canUpdatePasswordForSession(input: {
  sessionUserId: string | null;
  recoveryProof: PasswordRecoveryProof | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.sessionUserId) {
    return { ok: false, reason: "no_session" };
  }
  if (!isRecoveryProofValidForUser(input.recoveryProof, input.sessionUserId)) {
    return { ok: false, reason: "recovery_proof_invalid" };
  }
  return { ok: true };
}

export function maskedRecoveryEmail(email: string): string {
  return maskEmail(email);
}

export const STALE_SESSION_RESET_MESSAGE =
  "This page cannot change your password from an ordinary signed-in session. Open the newest reset link from your email (preferably in a private window), or ask an Administrator to send a new link.";

export const ACCOUNT_NOT_ACTIVATED_MESSAGE =
  "This staff record is not linked to an active sign-in account. Invite or activate the account before sending a password reset.";
