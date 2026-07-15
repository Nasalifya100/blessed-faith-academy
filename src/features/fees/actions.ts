"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { updateScheduleAmountSchema } from "./schemas";

export interface ActionResult {
  error: string | null;
}

const FEE_MANAGER_ROLES = ["administrator", "bursar", "headteacher"];
const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

async function assertFeeManager(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { ok: false, error: CONNECTION_ERROR };
  }
  const role = current.profile?.role;
  if (
    current.profile?.is_active &&
    role &&
    FEE_MANAGER_ROLES.includes(role)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "You are not authorized to manage fees.",
  };
}

export async function updateScheduleAmountAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = updateScheduleAmountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid amount.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("fee_schedules")
    .update({ amount: parsed.data.amount })
    .eq("id", parsed.data.scheduleId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/fees");
  return { error: null };
}
