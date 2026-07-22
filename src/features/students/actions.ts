"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canMigrateExistingStudents } from "@/features/auth/permissions";
import {
  createExistingStudentSchema,
  toExistingStudentRpcPayload,
} from "@/features/students/existing-student-schemas";
import {
  createStudentSchema,
  mapGuardianPayload,
  archiveStudentSchema,
  transferStudentClassSchema,
} from "./schemas";
import {
  updateGuardianProfileSchema,
  updateStudentProfileSchema,
} from "./profile-change-schemas";
export interface CreateStudentResult {
  error: string | null;
  studentId: string | null;
  nextAdmissionNumber: string | null;
}

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"] as const;
const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function assertStudentManager(): Promise<
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
      error:
        parsed.error.issues[0]?.message ??
        "Please check the form and try again.",
      studentId: null,
      nextAdmissionNumber: null,
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: studentId, error } = await supabase.rpc(
    "create_enrolled_student",
    {
      p_admission_number: data.admission_number,
      p_first_name: data.first_name.trim(),
      p_middle_name: data.middle_name?.trim() ?? "",
      p_last_name: data.last_name.trim(),
      p_date_of_birth: data.date_of_birth,
      p_gender: data.gender,
      p_enrollment_date: data.enrollment_date,
      p_class_id: data.class_id,
      p_place_of_birth: emptyToNull(data.place_of_birth),
      p_religious_denomination: emptyToNull(data.religious_denomination),
      p_previous_school: emptyToNull(data.previous_school),
      p_proposed_admission_date: emptyToNull(data.proposed_admission_date),
      p_vaccinated_smallpox: data.vaccinated_smallpox ?? null,
      p_vaccination_date: emptyToNull(data.vaccination_date),
      p_medical_notes: emptyToNull(data.medical_notes),
      p_is_zambian_citizen: data.is_zambian_citizen ?? null,
      p_guardians: data.guardians.map(mapGuardianPayload),
    },
  );

  if (error) {
    const message =
      error.message.includes("students_school_admission_number_lower_uidx") ||
      error.message.includes("students_school_id_admission_number_key") ||
      error.message.toLowerCase().includes("duplicate key")
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

export interface CreateExistingStudentResult {
  error: string | null;
  studentId: string | null;
  openingTotal: number | null;
}

async function assertExistingStudentMigrator(): Promise<
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
  if (current.profile?.is_active && canMigrateExistingStudents(role)) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      "You are not authorized to add existing students. This requires both student and fee management permission.",
  };
}

function mapExistingStudentError(message: string): string {
  const lower = message.toLowerCase();
  if (
    message.includes("students_school_admission_number_lower_uidx") ||
    message.includes("students_school_id_admission_number_key") ||
    lower.includes("admission number is already")
  ) {
    return "That admission number is already in use. Please use a different one.";
  }
  if (lower.includes("duplicate opening charge")) {
    return "Duplicate opening charge for the same fee type and period.";
  }
  if (lower.includes("previously paid cannot exceed")) {
    return "Previously paid cannot exceed the original amount.";
  }
  if (lower.includes("cannot be in the future")) {
    return "Admission date cannot be in the future.";
  }
  if (lower.includes("not authorized")) {
    return "You are not authorized to add existing students. This requires both student and fee management permission.";
  }
  if (lower.includes("generated charge already exists")) {
    return message;
  }
  return message;
}

export async function createExistingStudentAction(
  input: unknown,
): Promise<CreateExistingStudentResult> {
  const auth = await assertExistingStudentMigrator();
  if (!auth.ok) {
    return { error: auth.error, studentId: null, openingTotal: null };
  }

  const parsed = createExistingStudentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Please check the form and try again.",
      studentId: null,
      openingTotal: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const payload = toExistingStudentRpcPayload(parsed.data);

  const { data, error } = await supabase.rpc(
    "create_existing_student_migration",
    { p_payload: payload },
  );

  if (error) {
    return {
      error: mapExistingStudentError(error.message),
      studentId: null,
      openingTotal: null,
    };
  }

  const result = data as {
    student_id?: string;
    opening_total?: number | string;
  } | null;

  const studentId =
    typeof result?.student_id === "string" ? result.student_id : null;
  const openingTotal =
    result?.opening_total != null ? Number(result.opening_total) : 0;

  if (studentId) {
    revalidatePath("/dashboard/students");
    revalidatePath(`/dashboard/students/${studentId}`);
    revalidatePath("/dashboard/fees");
    revalidatePath("/dashboard/reports/fee-balances");
  }

  return {
    error: null,
    studentId,
    openingTotal: Number.isFinite(openingTotal) ? openingTotal : 0,
  };
}

export async function archiveStudentAction(
  input: unknown,
): Promise<{ error: string | null }> {
  const auth = await assertStudentManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = archiveStudentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("archive_student", {
    p_student_id: parsed.data.studentId,
    p_reason: parsed.data.reason?.trim() ?? "",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  revalidatePath("/dashboard/students");
  return { error: null };
}

export async function transferStudentClassAction(
  input: unknown,
): Promise<{ error: string | null }> {
  const auth = await assertStudentManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = transferStudentClassSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_student_class", {
    p_student_id: parsed.data.studentId,
    p_new_class_id: parsed.data.newClassId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/attendance");
  return { error: null };
}

export interface GuardianCandidate {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  nationalId: string | null;
  matchReason: string;
}

export async function listGuardianCandidatesAction(input: {
  nationalId?: string;
  phone?: string;
}): Promise<{ error: string | null; candidates: GuardianCandidate[] }> {
  const auth = await assertStudentManager();
  if (!auth.ok) {
    return { error: auth.error, candidates: [] };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_guardian_candidates", {
    p_national_id: input.nationalId?.trim() ?? "",
    p_phone: input.phone?.trim() ?? "",
  });

  if (error) {
    return { error: error.message, candidates: [] };
  }

  const rows =
    (data as {
      id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      national_id: string | null;
      match_reason: string;
    }[] | null) ?? [];

  return {
    error: null,
    candidates: rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      nationalId: row.national_id,
      matchReason: row.match_reason,
    })),
  };
}

export interface ProfileUpdateResult {
  error: string | null;
  sharedWithOtherStudents?: number;
}

export async function updateStudentProfileAction(
  input: unknown,
): Promise<ProfileUpdateResult> {
  const auth = await assertStudentManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = updateStudentProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Please check the form and try again.",
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("update_student_profile", {
    p_student_id: data.student_id,
    p_admission_number: data.admission_number,
    p_first_name: data.first_name.trim(),
    p_middle_name: data.middle_name?.trim() ?? "",
    p_last_name: data.last_name.trim(),
    p_date_of_birth: data.date_of_birth,
    p_gender: data.gender,
    p_enrollment_date: data.enrollment_date,
    p_place_of_birth: emptyToNull(data.place_of_birth),
    p_religious_denomination: emptyToNull(data.religious_denomination),
    p_previous_school: emptyToNull(data.previous_school),
    p_proposed_admission_date: emptyToNull(data.proposed_admission_date),
    p_is_zambian_citizen: data.is_zambian_citizen ?? null,
    p_medical_notes: emptyToNull(data.medical_notes),
    p_vaccinated_smallpox: data.vaccinated_smallpox ?? null,
    p_vaccination_date: emptyToNull(data.vaccination_date),
    p_change_reason: data.change_reason,
    p_change_note: emptyToNull(data.change_note),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${data.student_id}`);
  revalidatePath("/dashboard/students");
  return { error: null };
}

export async function updateGuardianProfileAction(
  input: unknown,
): Promise<ProfileUpdateResult> {
  const auth = await assertStudentManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = updateGuardianProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Please check the form and try again.",
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: result, error } = await supabase.rpc("update_guardian_profile", {
    p_student_id: data.student_id,
    p_guardian_id: data.guardian_id,
    p_first_name: data.first_name.trim(),
    p_last_name: data.last_name.trim(),
    p_phone: emptyToNull(data.phone),
    p_alt_phone: emptyToNull(data.alt_phone),
    p_whatsapp: emptyToNull(data.whatsapp),
    p_email: emptyToNull(data.email),
    p_national_id: emptyToNull(data.national_id),
    p_occupation: emptyToNull(data.occupation),
    p_address: emptyToNull(data.address),
    p_postal_address: emptyToNull(data.postal_address),
    p_relationship: data.relationship,
    p_is_primary_contact: data.is_primary_contact,
    p_is_emergency_contact: data.is_emergency_contact,
    p_change_reason: data.change_reason,
    p_change_note: emptyToNull(data.change_note),
  });

  if (error) {
    return { error: error.message };
  }

  const shared =
    typeof result === "object" &&
    result !== null &&
    "shared_with_other_students" in result
      ? Number(
          (result as { shared_with_other_students?: number })
            .shared_with_other_students ?? 0,
        )
      : 0;

  revalidatePath(`/dashboard/students/${data.student_id}`);
  revalidatePath("/dashboard/students");
  return { error: null, sharedWithOtherStudents: shared };
}
