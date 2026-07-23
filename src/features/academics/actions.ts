"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  hasAcademicCapability,
} from "@/features/academics/permissions";
import {
  bulkGradeOfferingsSchema,
  createClassSchema,
  gradingSchemeSchema,
  subjectSchema,
  teachingAssignmentSchema,
  weightSchemeSchema,
  workflowPeriodSchema,
} from "@/features/academics/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SESSION_ERROR = "Your session has expired. Please sign in again.";
const FORBIDDEN = "You are not authorized to change academic setup.";

type ActionResult = { error: string | null; id?: string | null };

function revalidateAcademics() {
  revalidatePath("/dashboard/settings/academics");
  revalidatePath("/dashboard/settings");
}

async function requireAcademicManager(
  capability:
    | "ACADEMIC_SETTINGS_MANAGE"
    | "SUBJECTS_MANAGE"
    | "SUBJECT_OFFERINGS_MANAGE"
    | "TEACHING_ASSIGNMENTS_MANAGE"
    | "GRADING_SCHEMES_MANAGE"
    | "ASSESSMENT_TYPES_MANAGE"
    | "ASSESSMENT_WEIGHTS_MANAGE"
    | "ACADEMIC_CALENDAR_MANAGE",
): Promise<{ error: string } | { ok: true }> {
  const current = await getCurrentUser();
  if (!current) return { error: SESSION_ERROR };
  if (!hasAcademicCapability(current.profile?.role, capability)) {
    return { error: FORBIDDEN };
  }
  return { ok: true };
}

export async function createClassAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("ACADEMIC_SETTINGS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = createClassSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid class." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_class", {
    p_grade_level_id: parsed.data.grade_level_id,
    p_academic_year_id: parsed.data.academic_year_id,
    p_name: parsed.data.name,
    p_stream_code: parsed.data.stream_code || null,
    p_capacity: parsed.data.capacity ?? null,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null, id: data as string };
}

export async function upsertSubjectAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("SUBJECTS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid subject." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_subject", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_short_name: parsed.data.short_name || null,
    p_code: parsed.data.code || null,
    p_category: parsed.data.subject_category,
    p_description: parsed.data.description || null,
    p_display_order: parsed.data.display_order,
    p_is_active: parsed.data.is_active,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null, id: data as string };
}

export async function setSubjectActiveAction(input: {
  subjectId: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const gate = await requireAcademicManager("SUBJECTS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_subject_active", {
    p_subject_id: input.subjectId,
    p_is_active: input.isActive,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null };
}

export async function bulkSetGradeOfferingsAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("SUBJECT_OFFERINGS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = bulkGradeOfferingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid offerings." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bulk_set_grade_subject_offerings", {
    p_academic_year_id: parsed.data.academic_year_id,
    p_grade_level_id: parsed.data.grade_level_id,
    p_items: parsed.data.items,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null };
}

export async function assignTeacherAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("TEACHING_ASSIGNMENTS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = teachingAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid assignment." };
  }
  const current = await getCurrentUser();
  if (
    current?.id === parsed.data.staff_id &&
    current.profile?.role === "teacher"
  ) {
    return { error: "You cannot assign yourself as a subject teacher." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("assign_subject_teacher", {
    p_subject_offering_id: parsed.data.subject_offering_id,
    p_staff_id: parsed.data.staff_id,
    p_class_id: parsed.data.class_id || null,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null, id: data as string };
}

export async function endTeachingAssignmentAction(
  assignmentId: string,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("TEACHING_ASSIGNMENTS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("end_teaching_assignment", {
    p_assignment_id: assignmentId,
    p_effective_to: null,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null };
}

export async function saveGradingSchemeAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("GRADING_SCHEMES_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = gradingSchemeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid grading scale." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_grading_scheme", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_bands: parsed.data.bands,
    p_make_default: parsed.data.make_default,
    p_confirm: parsed.data.confirm,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null, id: data as string };
}

export async function seedAssessmentTypesAction(): Promise<void> {
  const gate = await requireAcademicManager("ASSESSMENT_TYPES_MANAGE");
  if ("error" in gate) {
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("seed_default_assessment_types");
  revalidateAcademics();
}

export async function saveWeightSchemeAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("ASSESSMENT_WEIGHTS_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = weightSchemeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid weights." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_weight_scheme", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_items: parsed.data.items,
    p_make_default: parsed.data.make_default,
    p_confirm: parsed.data.confirm,
    p_academic_year_id: parsed.data.academic_year_id ?? null,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null, id: data as string };
}

export async function upsertWorkflowPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAcademicManager("ACADEMIC_CALENDAR_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const parsed = workflowPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid dates." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_workflow_period", {
    p_academic_year_id: parsed.data.academic_year_id,
    p_term_id: parsed.data.term_id || null,
    p_workflow_type: parsed.data.workflow_type,
    p_starts_at: parsed.data.starts_at,
    p_ends_at: parsed.data.ends_at || null,
    p_notes: parsed.data.notes || null,
  });
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null, id: data as string };
}

/** Assessment types seed used by form action and client helpers. */
export async function seedAssessmentTypesResultAction(): Promise<ActionResult> {
  const gate = await requireAcademicManager("ASSESSMENT_TYPES_MANAGE");
  if ("error" in gate) return { error: gate.error };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("seed_default_assessment_types");
  if (error) return { error: error.message };
  revalidateAcademics();
  return { error: null };
}
