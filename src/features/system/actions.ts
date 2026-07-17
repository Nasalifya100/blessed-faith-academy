"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canRunProductionReset,
  isProductionResetEnvEnabled,
} from "@/features/auth/permissions";
import {
  productionResetConfirmSchema,
  type ProductionResetResult,
} from "@/features/system/production-reset-schemas";

const SESSION_ERROR = "Your session has expired. Please sign in again.";
const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const FLAG_ERROR =
  "Production Reset is disabled. Set ALLOW_PRODUCTION_RESET=true on the server to enable it.";
const ROLE_ERROR = "Only an Administrator may run Production Reset.";

async function assertProductionResetAllowed(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isProductionResetEnvEnabled()) {
    return { ok: false, error: FLAG_ERROR };
  }

  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { ok: false, error: CONNECTION_ERROR };
  }
  if (
    !current.profile?.is_active ||
    !canRunProductionReset(current.profile.role)
  ) {
    return { ok: false, error: ROLE_ERROR };
  }
  return { ok: true };
}

function mapResetError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("confirmation phrase")) {
    return "Confirmation phrase is incorrect.";
  }
  if (lower.includes("school name")) {
    return "School name confirmation is incorrect.";
  }
  if (lower.includes("only an administrator")) {
    return ROLE_ERROR;
  }
  if (lower.includes("validation failed")) {
    return message;
  }
  return message;
}

export async function previewProductionResetAction(
  input: unknown,
): Promise<{ error: string | null; result: ProductionResetResult | null }> {
  const auth = await assertProductionResetAllowed();
  if (!auth.ok) {
    return { error: auth.error, result: null };
  }

  const parsed = productionResetConfirmSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Please complete all confirmation fields.",
      result: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reset_bfa_operational_data", {
    p_dry_run: true,
    p_school_name: parsed.data.schoolName,
    p_confirmation: parsed.data.confirmation,
  });

  if (error) {
    return { error: mapResetError(error.message), result: null };
  }

  return {
    error: null,
    result: data as ProductionResetResult,
  };
}

export async function executeProductionResetAction(
  input: unknown,
): Promise<{ error: string | null; result: ProductionResetResult | null }> {
  const auth = await assertProductionResetAllowed();
  if (!auth.ok) {
    return { error: auth.error, result: null };
  }

  const parsed = productionResetConfirmSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Please complete all confirmation fields.",
      result: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reset_bfa_operational_data", {
    p_dry_run: false,
    p_school_name: parsed.data.schoolName,
    p_confirmation: parsed.data.confirmation,
  });

  if (error) {
    return { error: mapResetError(error.message), result: null };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/applications");
  revalidatePath("/dashboard/fees");
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/discipline");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/settings/production-reset");

  return {
    error: null,
    result: data as ProductionResetResult,
  };
}
