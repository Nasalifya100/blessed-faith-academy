"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  createStaffSchema,
  setActiveSchema,
  updateRoleSchema,
} from "./schemas";

export interface ActionResult {
  error: string | null;
}

const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

/**
 * Confirms the caller is an active administrator. Every action below relies on
 * this because the admin client bypasses Row Level Security.
 *
 * Returns either the acting admin, or an error message that distinguishes a
 * connection problem from a genuine lack of permission.
 */
async function getActingAdmin(
  notAllowedMessage: string,
): Promise<
  | { admin: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; error: null }
  | { admin: null; error: string }
> {
  const current = await getCurrentUser();

  if (!current) {
    return { admin: null, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { admin: null, error: CONNECTION_ERROR };
  }
  if (current.profile?.role === "administrator" && current.profile.is_active) {
    return { admin: current, error: null };
  }
  return { admin: null, error: notAllowedMessage };
}

export async function createStaffAction(
  input: unknown,
): Promise<ActionResult> {
  const { admin, error: authError } = await getActingAdmin(
    "You are not authorized to create staff accounts.",
  );
  if (!admin) {
    return { error: authError };
  }

  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { full_name, email, password, role } = parsed.data;

  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/staff");
  return { error: null };
}

export async function updateStaffRoleAction(
  input: unknown,
): Promise<ActionResult> {
  const { admin, error: authError } = await getActingAdmin(
    "You are not authorized to change roles.",
  );
  if (!admin) {
    return { error: authError };
  }

  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid input." };
  }

  if (parsed.data.id === admin.id && parsed.data.role !== "administrator") {
    return { error: "You cannot remove your own administrator role." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/staff");
  return { error: null };
}

export async function setStaffActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const { admin, error: authError } = await getActingAdmin(
    "You are not authorized to change staff status.",
  );
  if (!admin) {
    return { error: authError };
  }

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid input." };
  }

  if (parsed.data.id === admin.id && !parsed.data.is_active) {
    return { error: "You cannot deactivate your own account." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/staff");
  return { error: null };
}
