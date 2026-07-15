"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  generateClassChargesSchema,
  generateStudentChargesSchema,
  updateScheduleAmountSchema,
} from "./schemas";


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

export interface GenerateChargesResult {
  error: string | null;
  createdCount: number;
}

export async function generateStudentChargesAction(
  input: unknown,
): Promise<GenerateChargesResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, createdCount: 0 };
  }

  const parsed = generateStudentChargesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid student.", createdCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_charges_for_student", {
    p_student_id: parsed.data.studentId,
    p_term_id: parsed.data.termId ?? null,
  });

  if (error) {
    return { error: error.message, createdCount: 0 };
  }

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  revalidatePath("/dashboard/students");
  return {
    error: null,
    createdCount: typeof data === "number" ? data : Number(data) || 0,
  };
}

export async function generateClassChargesAction(
  input: unknown,
): Promise<GenerateChargesResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, createdCount: 0 };
  }

  const parsed = generateClassChargesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid class.", createdCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_charges_for_class", {
    p_class_id: parsed.data.classId,
    p_term_id: parsed.data.termId ?? null,
  });

  if (error) {
    return { error: error.message, createdCount: 0 };
  }

  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/fees");
  return {
    error: null,
    createdCount: typeof data === "number" ? data : Number(data) || 0,
  };
}
