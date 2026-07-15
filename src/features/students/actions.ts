"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { createStudentSchema } from "./schemas";

export interface CreateStudentResult {
  error: string | null;
  studentId: string | null;
  nextAdmissionNumber: string | null;
}

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"] as const;
const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

async function assertStudentManager(): Promise<{ ok: true } | { ok: false; error: string }> {
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
    (MANAGER_ROLES as readonly string[]).includes(role)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "You are not authorized to add students.",
  };
}

export async function createStudentAction(
  input: unknown,
): Promise<CreateStudentResult> {
  const auth = await assertStudentManager();
  if (!auth.ok) {
    return { error: auth.error, studentId: null, nextAdmissionNumber: null };
  }

  const parsed = createStudentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
      studentId: null,
      nextAdmissionNumber: null,
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: studentId, error } = await supabase.rpc(
    "create_enrolled_student",
    {
      p_admission_number: data.admission_number.trim(),
      p_first_name: data.first_name.trim(),
      p_middle_name: data.middle_name?.trim() ?? "",
      p_last_name: data.last_name.trim(),
      p_date_of_birth: data.date_of_birth,
      p_gender: data.gender,
      p_enrollment_date: data.enrollment_date,
      p_class_id: data.class_id,
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
    const message = error.message.includes("students_school_id_admission_number_key")
      ? "That admission number is already in use. Please use a different one."
      : error.message;
    return { error: message, studentId: null, nextAdmissionNumber: null };
  }

  revalidatePath("/dashboard/students");

  const { data: nextSuggested } = await supabase.rpc(
    "suggest_admission_number",
  );

  return {
    error: null,
    studentId: typeof studentId === "string" ? studentId : null,
    nextAdmissionNumber:
      typeof nextSuggested === "string" ? nextSuggested : null,
  };
}
