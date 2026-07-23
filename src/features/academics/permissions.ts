import type { StaffRole } from "@/features/auth/types";
import { normalizeStaffRole } from "@/features/auth/permissions";

/** App-layer academic capability checks (mirrors DB role defaults). */
export type AcademicCapability =
  | "ACADEMIC_SETTINGS_MANAGE"
  | "SUBJECTS_MANAGE"
  | "SUBJECT_OFFERINGS_MANAGE"
  | "TEACHING_ASSIGNMENTS_MANAGE"
  | "GRADING_SCHEMES_MANAGE"
  | "ASSESSMENT_TYPES_MANAGE"
  | "ASSESSMENT_WEIGHTS_MANAGE"
  | "ACADEMIC_CALENDAR_MANAGE"
  | "ACADEMIC_CONFIGURATION_VIEW";

const HEAD_MANAGE: readonly AcademicCapability[] = [
  "ACADEMIC_CONFIGURATION_VIEW",
  "SUBJECTS_MANAGE",
  "SUBJECT_OFFERINGS_MANAGE",
  "TEACHING_ASSIGNMENTS_MANAGE",
  "GRADING_SCHEMES_MANAGE",
  "ASSESSMENT_TYPES_MANAGE",
  "ASSESSMENT_WEIGHTS_MANAGE",
  "ACADEMIC_CALENDAR_MANAGE",
  "ACADEMIC_SETTINGS_MANAGE",
] as const;

export function hasAcademicCapability(
  role: StaffRole | string | null | undefined,
  capability: AcademicCapability,
): boolean {
  const normalized = normalizeStaffRole(role);
  if (!normalized) return false;
  if (normalized === "administrator") return true;
  if (normalized === "headteacher") {
    return (HEAD_MANAGE as readonly string[]).includes(capability);
  }
  if (capability === "ACADEMIC_CONFIGURATION_VIEW") {
    return ["teacher", "secretary", "bursar", "headteacher"].includes(
      normalized,
    );
  }
  return false;
}

export function canOpenAcademicSetup(
  role: StaffRole | string | null | undefined,
): boolean {
  return (
    hasAcademicCapability(role, "ACADEMIC_SETTINGS_MANAGE") ||
    hasAcademicCapability(role, "SUBJECTS_MANAGE") ||
    hasAcademicCapability(role, "ACADEMIC_CONFIGURATION_VIEW")
  );
}

export function canManageAcademicConfig(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasAcademicCapability(role, "ACADEMIC_SETTINGS_MANAGE");
}
