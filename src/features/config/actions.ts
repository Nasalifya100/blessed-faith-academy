"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { z } from "zod";

const SESSION_ERROR = "Your session has expired. Please sign in again.";

async function assertAdmin(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (
    !current.profile?.is_active ||
    current.profile.role !== "administrator"
  ) {
    return {
      ok: false,
      error: "Only an administrator can change the current year or term.",
    };
  }
  return { ok: true };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function setCurrentAcademicYearAction(
  input: unknown,
): Promise<{ error: string | null }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { error: auth.error };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid academic year." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_current_academic_year", {
    p_year_id: parsed.data.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/fees");
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/reports");
  return { error: null };
}

export async function setCurrentTermAction(
  input: unknown,
): Promise<{ error: string | null }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { error: auth.error };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid term." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_current_term", {
    p_term_id: parsed.data.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/fees");
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/reports");
  return { error: null };
}
