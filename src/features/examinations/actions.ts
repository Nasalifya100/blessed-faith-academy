"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  hasExamCapability,
  type ExamCapability,
} from "@/features/examinations/permissions";
import {
  applyTemplateSchema,
  bulkAssignRoomSchema,
  bulkShiftDatesSchema,
  duplicateExamPeriodSchema,
  examExclusionSchema,
  examPeriodSchema,
  examRoomSchema,
  examScheduleSchema,
  examSchema,
  parseConflictWarnings,
  saveTemplateSchema,
  EXAM_PERIOD_STATUSES,
  transitionExamStatusSchema,
} from "@/features/examinations/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SESSION_ERROR = "Your session has expired. Please sign in again.";
const FORBIDDEN = "You are not authorized to manage examinations.";

type ActionResult = {
  error: string | null;
  id?: string | null;
  warnings?: ReturnType<typeof parseConflictWarnings>;
  requiresConfirmation?: boolean;
  count?: number;
};

function revalidateExams(periodId?: string) {
  revalidatePath("/dashboard/examinations");
  revalidatePath("/dashboard/examinations/upcoming");
  revalidatePath("/dashboard/examinations/rooms");
  revalidatePath("/dashboard/examinations/print");
  if (periodId) {
    revalidatePath(`/dashboard/examinations/periods/${periodId}`);
    revalidatePath(`/dashboard/examinations/periods/${periodId}/schedule`);
  }
}

async function requireExamCapability(
  capability: ExamCapability,
): Promise<{ error: string } | { ok: true }> {
  const current = await getCurrentUser();
  if (!current) return { error: SESSION_ERROR };
  if (!hasExamCapability(current.profile?.role, capability)) {
    return { error: FORBIDDEN };
  }
  return { ok: true };
}

export async function upsertExamPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_PERIODS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = examPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid exam period." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_exam_period", {
    p_id: parsed.data.id || null,
    p_academic_year_id: parsed.data.academic_year_id,
    p_term_id: parsed.data.term_id || null,
    p_name: parsed.data.name,
    p_description: parsed.data.description || null,
    p_opens_on: parsed.data.opens_on || null,
    p_closes_on: parsed.data.closes_on || null,
    p_status: parsed.data.status,
  });
  if (error) return { error: error.message };
  revalidateExams(data as string);
  return { error: null, id: data as string };
}

export async function duplicateExamPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_PERIODS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = duplicateExamPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid copy request." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_exam_period", {
    p_source_period_id: parsed.data.source_period_id,
    p_new_name: parsed.data.new_name,
    p_academic_year_id: parsed.data.academic_year_id || null,
    p_term_id: parsed.data.term_id || null,
    p_copy_exams: parsed.data.copy_exams,
    p_copy_schedules: parsed.data.copy_schedules,
  });
  if (error) return { error: error.message };
  revalidateExams(data as string);
  return { error: null, id: data as string };
}

export async function setExamPeriodStatusAction(
  periodId: string,
  status: (typeof EXAM_PERIOD_STATUSES)[number],
  force = false,
): Promise<
  ActionResult & { requiresConfirmation?: boolean; message?: string }
> {
  const gate = await requireExamCapability("EXAM_PERIODS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_exam_period_status", {
    p_period_id: periodId,
    p_status: status,
    p_force: force,
  });
  if (error) return { error: error.message };
  const payload = data as {
    ok?: boolean;
    requires_confirmation?: boolean;
    message?: string;
  } | null;
  if (payload?.requires_confirmation) {
    return {
      error: null,
      requiresConfirmation: true,
      message: payload.message,
    };
  }
  revalidateExams(periodId);
  return { error: null };
}

export async function transitionExamStatusAction(
  input: unknown,
): Promise<
  ActionResult & {
    missing?: { code: string; label: string; href_hint?: string }[];
    message?: string;
    status?: string;
  }
> {
  const gate = await requireExamCapability("EXAMS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = transitionExamStatusSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid status change.",
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("transition_exam_status", {
    p_exam_id: parsed.data.exam_id,
    p_new_status: parsed.data.new_status,
    p_reason: parsed.data.reason || null,
    p_force_future_complete: parsed.data.force_future_complete,
  });
  if (error) return { error: error.message };
  const payload = data as {
    ok?: boolean;
    status?: string;
    missing?: { code: string; label: string; href_hint?: string }[];
    message?: string;
  } | null;
  revalidatePath("/dashboard/examinations");
  if (!payload?.ok) {
    return {
      error: null,
      missing: payload?.missing ?? [],
      message: payload?.message ?? "Status change blocked.",
      status: payload?.status,
    };
  }
  return {
    error: null,
    id: parsed.data.exam_id,
    status: payload.status,
  };
}

export async function upsertExamAction(input: unknown): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAMS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = examSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid exam." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_exam", {
    p_id: parsed.data.id || null,
    p_exam_period_id: parsed.data.exam_period_id,
    p_subject_id: parsed.data.subject_id,
    p_grade_level_id: parsed.data.grade_level_id,
    p_class_id: parsed.data.class_id || null,
    p_assessment_type_id: parsed.data.assessment_type_id,
    p_max_marks: parsed.data.max_marks,
    p_instructions: parsed.data.instructions || null,
    p_notes: parsed.data.notes || null,
    p_cohort_scope: parsed.data.cohort_scope,
  });
  if (error) return { error: error.message };
  revalidateExams(parsed.data.exam_period_id);
  return { error: null, id: data as string };
}

export async function upsertExamScheduleAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_SCHEDULE_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = examScheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid schedule." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_exam_schedule", {
    p_exam_id: parsed.data.exam_id,
    p_exam_date: parsed.data.exam_date,
    p_start_time: parsed.data.start_time,
    p_end_time: parsed.data.end_time,
    p_room_id: parsed.data.room_id || null,
    p_primary_invigilator_id: parsed.data.primary_invigilator_id || null,
    p_assistant_invigilator_id: parsed.data.assistant_invigilator_id || null,
    p_notes: parsed.data.notes || null,
    p_capacity_override: parsed.data.capacity_override || null,
    p_allow_warnings: parsed.data.allow_warnings,
  });
  if (error) return { error: error.message };
  const payload = data as {
    ok?: boolean;
    schedule_id?: string;
    warnings?: unknown;
    requires_confirmation?: boolean;
  } | null;
  const warnings = parseConflictWarnings(payload?.warnings);
  revalidatePath("/dashboard/examinations");
  if (payload?.requires_confirmation) {
    return {
      error: null,
      id: payload.schedule_id ?? null,
      warnings,
      requiresConfirmation: true,
    };
  }
  return {
    error: null,
    id: payload?.schedule_id ?? null,
    warnings,
    requiresConfirmation: false,
  };
}

export async function upsertExamRoomAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_ROOMS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = examRoomSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid room." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_exam_room", {
    p_id: parsed.data.id || null,
    p_name: parsed.data.name,
    p_capacity: parsed.data.capacity ?? null,
    p_notes: parsed.data.notes || null,
    p_is_active: parsed.data.is_active,
  });
  if (error) return { error: error.message };
  revalidateExams();
  return { error: null, id: data as string };
}

export async function upsertExamExclusionAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAMS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = examExclusionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid exclusion." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_exam_exclusion", {
    p_exam_id: parsed.data.exam_id,
    p_student_id: parsed.data.student_id,
    p_reason: parsed.data.reason,
    p_notes: parsed.data.notes || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/examinations");
  return { error: null, id: data as string };
}

export async function removeExamExclusionAction(
  exclusionId: string,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAMS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_exam_exclusion", {
    p_exclusion_id: exclusionId,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/examinations");
  return { error: null };
}

export async function saveExamTemplateAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_TEMPLATES_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid template." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_exam_template_from_period", {
    p_period_id: parsed.data.period_id,
    p_template_name: parsed.data.template_name,
    p_description: parsed.data.description || null,
  });
  if (error) return { error: error.message };
  revalidateExams(parsed.data.period_id);
  return { error: null, id: data as string };
}

export async function applyExamTemplateAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_TEMPLATES_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = applyTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid template." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("apply_exam_template", {
    p_template_id: parsed.data.template_id,
    p_exam_period_id: parsed.data.exam_period_id,
  });
  if (error) return { error: error.message };
  revalidateExams(parsed.data.exam_period_id);
  return { error: null, count: Number(data ?? 0) };
}

export async function bulkShiftExamDatesAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_SCHEDULE_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = bulkShiftDatesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid date shift." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_shift_exam_dates", {
    p_exam_period_id: parsed.data.exam_period_id,
    p_day_offset: parsed.data.day_offset,
  });
  if (error) return { error: error.message };
  revalidateExams(parsed.data.exam_period_id);
  return { error: null, count: Number(data ?? 0) };
}

export async function bulkAssignRoomAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_SCHEDULE_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = bulkAssignRoomSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid room assign." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_assign_room_to_period", {
    p_exam_period_id: parsed.data.exam_period_id,
    p_room_id: parsed.data.room_id,
  });
  if (error) return { error: error.message };
  revalidateExams(parsed.data.exam_period_id);
  return { error: null, count: Number(data ?? 0) };
}

export async function bulkArchiveClosedPeriodsAction(): Promise<ActionResult> {
  const gate = await requireExamCapability("EXAM_PERIODS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_archive_closed_exam_periods");
  if (error) return { error: error.message };
  revalidateExams();
  return { error: null, count: Number(data ?? 0) };
}
