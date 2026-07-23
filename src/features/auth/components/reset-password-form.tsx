"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { logPasswordChangedAction } from "@/features/auth/password-reset-actions";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/features/auth/password-reset-schemas";
import {
  canUpdatePasswordForSession,
  createRecoveryProof,
  hasRecoveryCredential,
  isRecoveryProofValidForUser,
  maskedRecoveryEmail,
  parseRecoveryProof,
  parseRecoveryUrlSignals,
  PASSWORD_RECOVERY_STORAGE_KEY,
  serializeRecoveryProof,
  STALE_SESSION_RESET_MESSAGE,
  type PasswordRecoveryProof,
} from "@/features/auth/password-recovery";
import {
  PASSWORD_RESET_LINK_INVALID_MESSAGE,
  passwordResetLinkErrorMessage,
} from "@/lib/site-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LinkState = "loading" | "ready" | "invalid";

function scrubResetUrl(url: URL) {
  const keys = [
    "code",
    "token_hash",
    "type",
    "error",
    "error_code",
    "error_description",
  ];
  for (const key of keys) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function readStoredProof(): PasswordRecoveryProof | null {
  try {
    return parseRecoveryProof(
      sessionStorage.getItem(PASSWORD_RECOVERY_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function writeStoredProof(proof: PasswordRecoveryProof) {
  sessionStorage.setItem(
    PASSWORD_RECOVERY_STORAGE_KEY,
    serializeRecoveryProof(proof),
  );
}

function clearStoredProof() {
  try {
    sessionStorage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function hashTokens(href: string): {
  access_token: string;
  refresh_token: string;
} | null {
  const url = new URL(href);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>("loading");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let cancelled = false;

    async function establishFromUser(user: {
      id: string;
      email?: string | null;
    }) {
      const proof = createRecoveryProof({
        userId: user.id,
        email: user.email,
      });
      writeStoredProof(proof);
      if (cancelled) return;
      setRecoveryUserId(user.id);
      setTargetEmail(user.email ?? null);
      setLinkState("ready");
    }

    async function prepareSession() {
      const supabase = createSupabaseBrowserClient();
      const href = window.location.href;
      const url = new URL(href);
      const signals = parseRecoveryUrlSignals(href);

      const linkErrorMessage = passwordResetLinkErrorMessage({
        error: signals.error,
        errorCode: signals.errorCode,
        errorDescription: signals.errorDescription,
      });
      if (linkErrorMessage) {
        if (cancelled) return;
        clearStoredProof();
        scrubResetUrl(url);
        setLinkError(linkErrorMessage);
        setLinkState("invalid");
        return;
      }

      // Consume recovery credentials — never trust a pre-existing session.
      if (hasRecoveryCredential(signals)) {
        // Drop any ordinary admin/staff session before establishing recovery.
        await supabase.auth.signOut({ scope: "local" });
        clearStoredProof();

        if (signals.code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(
            signals.code,
          );
          if (cancelled) return;
          if (error || !data.user) {
            scrubResetUrl(url);
            setLinkError(PASSWORD_RESET_LINK_INVALID_MESSAGE);
            setLinkState("invalid");
            return;
          }
          scrubResetUrl(url);
          await establishFromUser(data.user);
          return;
        }

        if (signals.tokenHash && signals.otpType === "recovery") {
          const { data, error } = await supabase.auth.verifyOtp({
            type: "recovery" as EmailOtpType,
            token_hash: signals.tokenHash,
          });
          if (cancelled) return;
          if (error || !data.user) {
            scrubResetUrl(url);
            setLinkError(PASSWORD_RESET_LINK_INVALID_MESSAGE);
            setLinkState("invalid");
            return;
          }
          scrubResetUrl(url);
          await establishFromUser(data.user);
          return;
        }

        const tokens = hashTokens(href);
        if (tokens) {
          const { data, error } = await supabase.auth.setSession(tokens);
          if (cancelled) return;
          if (error || !data.user) {
            scrubResetUrl(url);
            setLinkError(PASSWORD_RESET_LINK_INVALID_MESSAGE);
            setLinkState("invalid");
            return;
          }
          scrubResetUrl(url);
          await establishFromUser(data.user);
          return;
        }

        // Wait briefly for PASSWORD_RECOVERY from detectSessionInUrl.
        const recovered = await new Promise<boolean>((resolve) => {
          const timeout = window.setTimeout(() => {
            subscription.unsubscribe();
            resolve(false);
          }, 1500);
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === "PASSWORD_RECOVERY" && session?.user) {
              window.clearTimeout(timeout);
              subscription.unsubscribe();
              void establishFromUser(session.user).then(() => resolve(true));
            }
          });
        });
        if (cancelled) return;
        if (recovered) {
          scrubResetUrl(url);
          return;
        }
        scrubResetUrl(url);
        setLinkError(PASSWORD_RESET_LINK_INVALID_MESSAGE);
        setLinkState("invalid");
        return;
      }

      // No credentials in URL — only continue if this tab already established
      // recovery (e.g. after scrubbing the query string on refresh).
      const proof = readStoredProof();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (cancelled) return;

      if (user && isRecoveryProofValidForUser(proof, user.id)) {
        setRecoveryUserId(user.id);
        setTargetEmail(user.email ?? proof?.email ?? null);
        setLinkState("ready");
        return;
      }

      if (user && !isRecoveryProofValidForUser(proof, user.id)) {
        clearStoredProof();
        scrubResetUrl(url);
        setLinkError(STALE_SESSION_RESET_MESSAGE);
        setLinkState("invalid");
        return;
      }

      clearStoredProof();
      scrubResetUrl(url);
      setLinkError(PASSWORD_RESET_LINK_INVALID_MESSAGE);
      setLinkState("invalid");
    }

    void prepareSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    const supabase = createSupabaseBrowserClient();
    const proof = readStoredProof();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    const gate = canUpdatePasswordForSession({
      sessionUserId: user?.id ?? null,
      recoveryProof: proof,
    });
    if (!gate.ok || !user) {
      setServerError(STALE_SESSION_RESET_MESSAGE);
      setLinkState("invalid");
      return;
    }

    if (recoveryUserId && user.id !== recoveryUserId) {
      setServerError(STALE_SESSION_RESET_MESSAGE);
      setLinkState("invalid");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });

    if (error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("session") || lower.includes("expired")) {
        setServerError(PASSWORD_RESET_LINK_INVALID_MESSAGE);
      } else if (lower.includes("weak") || lower.includes("password")) {
        setServerError(
          "That password does not meet security requirements. Choose a stronger password.",
        );
      } else {
        setServerError(
          "Could not update your password. Request a new reset link and try again.",
        );
      }
      return;
    }

    await logPasswordChangedAction();
    clearStoredProof();
    await supabase.auth.signOut({ scope: "global" });
    setSuccess(true);
    window.setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1500);
  }

  if (linkState === "loading") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Checking reset link…
      </p>
    );
  }

  if (linkState === "invalid") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive" role="alert">
          {linkError ?? PASSWORD_RESET_LINK_INVALID_MESSAGE}
        </p>
        <p className="text-sm text-muted-foreground">
          Ask an Administrator to send a new reset link from Staff. Open the
          newest link from your email — preferably in a private window. Older
          or already-used links will not work.
        </p>
        <p className="text-center text-sm">
          <Link href="/login" className="underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Password updated successfully. Sign in with your new password…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {targetEmail ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          Resetting password for:{" "}
          <span className="font-medium">{maskedRecoveryEmail(targetEmail)}</span>
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Choose a new password with at least 8 characters, including a letter
        and a number.
      </p>

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirmPassword)}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p className="text-sm text-destructive">
            {errors.confirmPassword.message}
          </p>
        ) : null}
      </div>

      {serverError ? (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Updating…" : "Update password"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
