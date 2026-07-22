import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fieldLabel,
  formatProfileAuditValue,
  maskSensitiveValue,
  MEDICAL_PROFILE_FIELDS,
  reasonLabel,
  SENSITIVE_PROFILE_FIELDS,
} from "@/features/students/profile-change-schemas";

export interface ProfileChangeHistoryEntry {
  id: string;
  createdAt: string;
  entityType: "student" | "guardian";
  fieldName: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  changeReason: string;
  changeReasonLabel: string;
  changeNote: string | null;
  isSensitive: boolean;
  changedByName: string;
  guardianId: string | null;
}

interface AuditRow {
  id: string;
  student_id: string;
  guardian_id: string | null;
  entity_type: "student" | "guardian";
  field_name: string;
  field_label: string;
  old_value: string | null;
  new_value: string | null;
  change_reason: string;
  change_note: string | null;
  is_sensitive: boolean;
  created_at: string;
  changed_by: string | null;
}

const DEFAULT_LIMIT = 50;

/**
 * Profile corrections for this pupil, including guardian edits that affect
 * shared guardians linked to the pupil (even if edited from a sibling).
 */
export async function listStudentProfileChangeHistory(
  studentId: string,
  options?: {
    limit?: number;
    canViewMedical?: boolean;
    canViewSensitiveContact?: boolean;
  },
): Promise<ProfileChangeHistoryEntry[]> {
  const supabase = await createSupabaseServerClient();
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const canViewMedical = options?.canViewMedical ?? false;
  const canViewSensitiveContact = options?.canViewSensitiveContact ?? false;

  const { data: links } = await supabase
    .from("student_guardians")
    .select("guardian_id")
    .eq("student_id", studentId);

  const guardianIds = (
    (links as { guardian_id: string }[] | null) ?? []
  ).map((row) => row.guardian_id);

  let query = supabase
    .from("student_profile_change_audits")
    .select(
      "id, student_id, guardian_id, entity_type, field_name, field_label, old_value, new_value, change_reason, change_note, is_sensitive, created_at, changed_by",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (guardianIds.length > 0) {
    query = query.or(
      `student_id.eq.${studentId},guardian_id.in.(${guardianIds.join(",")})`,
    );
  } else {
    query = query.eq("student_id", studentId);
  }

  const { data, error } = await query;
  if (error || !data) {
    return [];
  }

  const rows = data as AuditRow[];
  const actorIds = [
    ...new Set(
      rows
        .map((row) => row.changed_by)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);

    for (const profile of (profiles as
      | { id: string; full_name: string }[]
      | null) ?? []) {
      nameById.set(profile.id, profile.full_name);
    }
  }

  return rows.map((row) => {
    const sensitive =
      row.is_sensitive || SENSITIVE_PROFILE_FIELDS.has(row.field_name);
    const medical = MEDICAL_PROFILE_FIELDS.has(row.field_name);
    const hide =
      (medical && !canViewMedical) ||
      (sensitive && !medical && !canViewSensitiveContact);

    return {
      id: row.id,
      createdAt: row.created_at,
      entityType: row.entity_type,
      fieldName: row.field_name,
      fieldLabel: fieldLabel(row.field_name, row.field_label),
      oldValue: hide
        ? maskSensitiveValue(row.old_value, row.field_name)
        : formatProfileAuditValue(row.old_value, row.field_name),
      newValue: hide
        ? maskSensitiveValue(row.new_value, row.field_name)
        : formatProfileAuditValue(row.new_value, row.field_name),
      changeReason: row.change_reason,
      changeReasonLabel: reasonLabel(row.change_reason),
      changeNote: row.change_note,
      isSensitive: sensitive,
      changedByName: row.changed_by
        ? (nameById.get(row.changed_by) ?? "Staff member")
        : "Staff member",
      guardianId: row.guardian_id,
    };
  });
}
