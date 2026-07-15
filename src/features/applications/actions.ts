"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  approveApplicationSchema,
  createApplicationSchema,
  rejectApplicationSchema,
} from "./schemas";

const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"];
const REVIEWER_ROLES = ["administrator", "headteacher"];

async function assertRole(
  allowedRoles: string[],
  notAllowedMessage: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { ok: false, error: CONNECTION_ERROR };
  }
  const role = current.profile?.role;
  if (current.profile?.is_active && role && allowedRoles.includes(role)) {
    return { ok: true };
  }
  return { ok: false, error: notAllowedMessage };
}

export interface CreateApplicationResult {
  error: string | null;
  applicationId: string | null;
}

export async function createApplicationAction(
  input: unknown,
): Promise<CreateApplicationResult> {
  const auth = await assertRole(
    MANAGER_ROLES,
    "You are not authorized to create applications.",
  );
  if (!auth.ok) {
    return { error: auth.error, applicationId: null };
  }

  const parsed = createApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Please check the form and try again.",
      applicationId: null,
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: applicationId, error } = await supabase.rpc(
    "create_application",
    {
      p_admission_number: data.admission_number.trim(),
      p_first_name: data.first_name.trim(),
      p_middle_name: data.middle_name?.trim() ?? "",
      p_last_name: data.last_name.trim(),
      p_date_of_birth: data.date_of_birth,
      p_gender: data.gender,
      p_applied_class_id: data.applied_class_id,
      p_consent_agreed: data.consent_agreed,
      p_consent_signed_by: data.consent_signed_by.trim(),
      p_consent_signed_at: data.consent_signed_at,
      p_guardians: data.guardians.map((guardian) => ({
        first_name: guardian.first_name.trim(),
        last_name: guardian.last_name.trim(),
        relationship: guardian.relationship,
        phone: guardian.phone ?? "",
        alt_phone: guardian.alt_phone ?? "",
        email: guardian.email ?? "",
        national_id: guardian.national_id ?? "",
        occupation: guardian.occupation ?? "",
        address: guardian.address ?? "",
        is_primary_contact: guardian.is_primary_contact,
        is_emergency_contact: guardian.is_emergency_contact,
      })),
    },
  );

  if (error) {
    const message = error.message.includes(
      "students_school_id_admission_number_key",
    )
      ? "That admission number is already in use. Please use a different one."
      : error.message;
    return { error: message, applicationId: null };
  }

  revalidatePath("/dashboard/applications");
  return {
    error: null,
    applicationId: typeof applicationId === "string" ? applicationId : null,
  };
}

export interface ActionResult {
  error: string | null;
}

export async function approveApplicationAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertRole(
    REVIEWER_ROLES,
    "You are not authorized to approve applications.",
  );
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = approveApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_application", {
    p_application_id: parsed.data.applicationId,
    p_class_id: parsed.data.class_id,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/applications");
  revalidatePath(`/dashboard/applications/${parsed.data.applicationId}`);
  revalidatePath("/dashboard/students");
  return { error: null };
}

export async function rejectApplicationAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertRole(
    REVIEWER_ROLES,
    "You are not authorized to reject applications.",
  );
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = rejectApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reject_application", {
    p_application_id: parsed.data.applicationId,
    p_notes: parsed.data.notes ?? "",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/applications");
  revalidatePath(`/dashboard/applications/${parsed.data.applicationId}`);
  return { error: null };
}
