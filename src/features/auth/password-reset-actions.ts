"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getPasswordResetRedirectUrl } from "@/lib/site-url";
import { adminSendPasswordResetSchema } from "@/features/auth/password-reset-schemas";

const SESSION_ERROR = "Your session has expired. Please sign in again.";
const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";

async function logPasswordResetEvent(input: {
  targetUserId: string | null;
  targetProfileId: string | null;
  targetEmail: string;
  actionType: "admin_reset_email_requested" | "password_changed";
  initiatedBy: string | null;
  resultStatus: "success" | "failure" | "accepted";
  failureCategory?: string | null;
  schoolId?: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.rpc("log_password_reset_event", {
    p_target_user_id: input.targetUserId,
    p_target_profile_id: input.targetProfileId,
    p_target_email: input.targetEmail,
    p_action_type: input.actionType,
    p_initiated_by: input.initiatedBy,
    p_result_status: input.resultStatus,
    p_failure_category: input.failureCategory ?? null,
    p_school_id: input.schoolId ?? null,
  });
}

export async function logPasswordChangedAction(): Promise<{
  error: string | null;
}> {
  const current = await getCurrentUser();
  if (!current) {
    return { error: SESSION_ERROR };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.auth.admin.getUserById(current.id);
    const email = data.user?.email ?? "unknown";

    await logPasswordResetEvent({
      targetUserId: current.id,
      targetProfileId: current.profile?.id ?? current.id,
      targetEmail: email,
      actionType: "password_changed",
      initiatedBy: current.id,
      resultStatus: "success",
      schoolId: current.profile?.school_id ?? null,
    });
  } catch {
    // Password already changed; audit failure must not undo that.
  }

  return { error: null };
}

/**
 * Administrator-only: email a password reset link to a staff member.
 * Self-service forgot-password is intentionally not provided.
 */
export async function adminSendPasswordResetAction(
  input: unknown,
): Promise<{ error: string | null }> {
  const current = await getCurrentUser();
  if (!current) {
    return { error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { error: CONNECTION_ERROR };
  }
  if (
    !(current.profile?.role === "administrator" && current.profile.is_active)
  ) {
    return { error: "Only an Administrator may send password reset emails." };
  }

  const parsed = adminSendPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid staff account.",
    };
  }

  const staffId = parsed.data.staffId;
  const supabase = await createSupabaseServerClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, school_id, full_name, role, is_active")
    .eq("id", staffId)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: "Staff account not found." };
  }

  if (!profile.is_active) {
    return {
      error:
        "This account is deactivated. Activate it before sending a reset link.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: authUser, error: userError } =
    await admin.auth.admin.getUserById(staffId);

  if (userError || !authUser.user?.email) {
    await logPasswordResetEvent({
      targetUserId: staffId,
      targetProfileId: staffId,
      targetEmail: "unknown",
      actionType: "admin_reset_email_requested",
      initiatedBy: current.id,
      resultStatus: "failure",
      failureCategory: "missing_email",
      schoolId: profile.school_id,
    });
    return { error: "This staff account has no email address on file." };
  }

  const email = authUser.user.email;
  const redirectTo = getPasswordResetRedirectUrl();

  const { error: resetError } = await supabase.auth.resetPasswordForEmail(
    email,
    { redirectTo },
  );

  await logPasswordResetEvent({
    targetUserId: staffId,
    targetProfileId: staffId,
    targetEmail: email,
    actionType: "admin_reset_email_requested",
    initiatedBy: current.id,
    resultStatus: resetError ? "failure" : "success",
    failureCategory: resetError ? "provider_error" : null,
    schoolId: profile.school_id,
  });

  if (resetError) {
    return {
      error:
        "Could not send the reset email. Try again shortly or check Auth email settings.",
    };
  }

  return { error: null };
}
