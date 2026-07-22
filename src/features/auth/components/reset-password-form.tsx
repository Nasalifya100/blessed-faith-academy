"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { logPasswordChangedAction } from "@/features/auth/password-reset-actions";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/features/auth/password-reset-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LinkState = "loading" | "ready" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>("loading");
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

    async function prepareSession() {
      const supabase = createSupabaseBrowserClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          setLinkState("invalid");
          return;
        }
        // Remove code from the address bar without a full navigation.
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.pathname);
        setLinkState("ready");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setLinkState("ready");
        return;
      }

      // Hash tokens (implicit flow) — give the client a moment to hydrate.
      if (url.hash.includes("access_token") || url.hash.includes("type=recovery")) {
        const { data: afterHash } = await supabase.auth.getSession();
        if (cancelled) return;
        setLinkState(afterHash.session ? "ready" : "invalid");
        return;
      }

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
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });

    if (error) {
      setServerError(
        error.message.toLowerCase().includes("session")
          ? "This reset link is invalid or has expired. Request a new one."
          : "Could not update your password. Try a new reset link.",
      );
      return;
    }

    await logPasswordChangedAction();
    await supabase.auth.signOut();
    setSuccess(true);
    router.replace("/login");
    router.refresh();
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
          This password reset link is invalid or has expired. Ask an
          Administrator to send a new reset link from Staff.
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
        Password updated. Redirecting to sign in…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
