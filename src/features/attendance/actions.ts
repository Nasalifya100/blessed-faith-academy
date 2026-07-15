"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  assignAttendanceCoverSchema,
  revokeAttendanceCoverSchema,
  saveClassAttendanceSchema,
  setHomeroomTeacherSchema,
} from "./schemas";

export interface ActionResult {
  error: string | null;
}

const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

const COVER_MANAGER_ROLES = ["administrator", "headteacher", "secretary"];
const ATTENDANCE_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];

async function assertAttendanceUser(): Promise<
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
    ATTENDANCE_ROLES.includes(role)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "You are not authorized to take attendance.",
  };
}

async function assertCoverManager(): Promise<
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
    COVER_MANAGER_ROLES.includes(role)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "You are not authorized to manage cover teachers.",
  };
}

export interface SaveAttendanceResult {
  error: string | null;
  savedCount: number;
}

export async function saveClassAttendanceAction(
  input: unknown,
): Promise<SaveAttendanceResult> {
  const auth = await assertAttendanceUser();
  if (!auth.ok) {
    return { error: auth.error, savedCount: 0 };
  }

  const parsed = saveClassAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the register.",
      savedCount: 0,
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const marks = data.marks.map((mark) => ({
    student_id: mark.studentId,
    status: mark.status,
    notes: mark.notes?.trim() ?? "",
  }));

  const { data: saved, error } = await supabase.rpc("save_class_attendance", {
    p_class_id: data.classId,
    p_attendance_date: data.attendanceDate,
    p_marks: marks,
  });

  if (error) {
    return { error: error.message, savedCount: 0 };
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/attendance/${data.classId}`);
  return {
    error: null,
    savedCount: typeof saved === "number" ? saved : Number(saved) || 0,
  };
}

export async function assignAttendanceCoverAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCoverManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = assignAttendanceCoverSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("assign_attendance_cover", {
    p_class_id: data.classId,
    p_staff_id: data.staffId,
    p_valid_from: data.validFrom,
    p_valid_until: data.validUntil?.trim() ? data.validUntil : null,
    p_reason: data.reason?.trim() ?? "",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/covers");
  return { error: null };
}

export async function revokeAttendanceCoverAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCoverManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = revokeAttendanceCoverSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid cover assignment." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_attendance_cover", {
    p_cover_id: parsed.data.coverId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/covers");
  return { error: null };
}

export async function setHomeroomTeacherAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCoverManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = setHomeroomTeacherSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid class or teacher." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_class_homeroom_teacher", {
    p_class_id: parsed.data.classId,
    p_staff_id: parsed.data.staffId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/covers");
  return { error: null };
}
