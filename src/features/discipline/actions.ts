"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  createDisciplineIncidentSchema,
  resolveDisciplineIncidentSchema,
  updateSchoolRuleSchema,
} from "./schemas";

export interface ActionResult {
  error: string | null;
}

const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

const RECORD_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const MANAGE_ROLES = ["administrator", "headteacher", "secretary"];
const RULE_MANAGER_ROLES = ["administrator", "headteacher"];

async function getActiveRole(): Promise<
  | { ok: true; role: string }
  | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { ok: false, error: CONNECTION_ERROR };
  }
  if (!current.profile?.is_active || !current.profile.role) {
    return { ok: false, error: "You are not authorized." };
  }
  return { ok: true, role: current.profile.role };
}

export async function createDisciplineIncidentAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await getActiveRole();
  if (!auth.ok) {
    return { error: auth.error };
  }
  if (!RECORD_ROLES.includes(auth.role)) {
    return { error: "You are not authorized to record incidents." };
  }

  const parsed = createDisciplineIncidentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const data = parsed.data;
  const relatedRuleId =
    data.relatedRuleId && data.relatedRuleId !== ""
      ? data.relatedRuleId
      : null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_discipline_incident", {
    p_student_id: data.studentId,
    p_title: data.title,
    p_description: data.description?.trim() ?? "",
    p_action_taken: data.actionTaken?.trim() ?? "",
    p_severity: data.severity,
    p_incident_date: data.incidentDate,
    p_related_rule_id: relatedRuleId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${data.studentId}`);
  revalidatePath("/dashboard/discipline");
  return { error: null };
}

export async function resolveDisciplineIncidentAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await getActiveRole();
  if (!auth.ok) {
    return { error: auth.error };
  }
  if (!MANAGE_ROLES.includes(auth.role)) {
    return { error: "You are not authorized to resolve incidents." };
  }

  const parsed = resolveDisciplineIncidentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid incident." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resolve_discipline_incident", {
    p_incident_id: parsed.data.incidentId,
    p_action_taken: parsed.data.actionTaken?.trim() || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  revalidatePath("/dashboard/discipline");
  return { error: null };
}

export async function updateSchoolRuleAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await getActiveRole();
  if (!auth.ok) {
    return { error: auth.error };
  }
  if (!RULE_MANAGER_ROLES.includes(auth.role)) {
    return { error: "You are not authorized to edit school rules." };
  }

  const parsed = updateSchoolRuleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("school_rules")
    .update({
      title: data.title,
      body: data.body,
      sort_order: data.sortOrder,
      is_active: data.isActive,
    })
    .eq("id", data.ruleId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/rules");
  return { error: null };
}
