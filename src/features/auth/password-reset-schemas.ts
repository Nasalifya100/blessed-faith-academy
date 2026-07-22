import { z } from "zod";

/**
 * Password policy for recovery (aligned with staff create min length,
 * with a light complexity check).
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long")
  .refine(
    (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
    "Use at least one letter and one number",
  );

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const adminSendPasswordResetSchema = z.object({
  staffId: z.string().uuid("Invalid staff account"),
});

export type AdminSendPasswordResetInput = z.infer<
  typeof adminSendPasswordResetSchema
>;

export const PASSWORD_RESET_ACTION_TYPES = [
  "admin_reset_email_requested",
  "password_changed",
] as const;

export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at < 2) return "***";
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.length <= 2) {
    return `${local[0]}*@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/** Ensure audit payloads never include credential material. */
export function assertSafeAuditMetadata(
  metadata: Record<string, unknown>,
): boolean {
  const banned = [
    "password",
    "temporary_password",
    "token",
    "access_token",
    "refresh_token",
    "service_role",
    "serviceRole",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const json = JSON.stringify(metadata).toLowerCase();
  return !banned.some((key) => json.includes(key.toLowerCase()));
}
