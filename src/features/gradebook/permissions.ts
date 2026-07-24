import type { StaffRole } from "@/features/auth/types";
import { normalizeStaffRole } from "@/features/auth/permissions";
import {
  hasAcademicCapability,
  type AcademicCapability as BaseAcademicCapability,
} from "@/features/academics/permissions";

/** Mirrors DB gradebook capabilities (Phase 2C Stage 1). */
export type GradebookCapability =
  | BaseAcademicCapability
  | "EXAM_VIEW"
  | "GRADEBOOK_ENTER"
  | "GRADEBOOK_VIEW_ALL"
  | "GRADEBOOK_REOPEN"
  | "GRADEBOOK_CORRECT"
  | "GRADEBOOK_LOCK";

const HEAD_GRADEBOOK: readonly GradebookCapability[] = [
  "GRADEBOOK_ENTER",
  "GRADEBOOK_VIEW_ALL",
  "GRADEBOOK_REOPEN",
  "GRADEBOOK_CORRECT",
  "GRADEBOOK_LOCK",
] as const;

export function hasGradebookCapability(
  role: StaffRole | string | null | undefined,
  capability: GradebookCapability,
): boolean {
  const normalized = normalizeStaffRole(role);
  if (!normalized) return false;
  if (normalized === "administrator") return true;

  if (
    (
      [
        "ACADEMIC_SETTINGS_MANAGE",
        "SUBJECTS_MANAGE",
        "SUBJECT_OFFERINGS_MANAGE",
        "TEACHING_ASSIGNMENTS_MANAGE",
        "GRADING_SCHEMES_MANAGE",
        "ASSESSMENT_TYPES_MANAGE",
        "ASSESSMENT_WEIGHTS_MANAGE",
        "ACADEMIC_CALENDAR_MANAGE",
        "ACADEMIC_CONFIGURATION_VIEW",
      ] as string[]
    ).includes(capability)
  ) {
    return hasAcademicCapability(role, capability as BaseAcademicCapability);
  }

  if (normalized === "headteacher") {
    if (capability === "EXAM_VIEW") return true;
    return (HEAD_GRADEBOOK as readonly string[]).includes(capability);
  }

  if (capability === "GRADEBOOK_ENTER") {
    return normalized === "teacher";
  }

  // GRADEBOOK_VIEW_ALL / REOPEN / CORRECT / LOCK: headteacher handled above;
  // secretary/bursar intentionally false here (marks are sensitive; DB override only).

  if (capability === "EXAM_VIEW") {
    return ["teacher", "secretary", "bursar", "headteacher"].includes(
      normalized,
    );
  }

  return false;
}

export function canOpenGradebook(
  role: StaffRole | string | null | undefined,
): boolean {
  return (
    hasGradebookCapability(role, "GRADEBOOK_ENTER") ||
    hasGradebookCapability(role, "GRADEBOOK_VIEW_ALL")
  );
}

export function canEnterGradebookMarks(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasGradebookCapability(role, "GRADEBOOK_ENTER");
}

export function canReopenGradebook(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasGradebookCapability(role, "GRADEBOOK_REOPEN");
}

export function canLockGradebook(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasGradebookCapability(role, "GRADEBOOK_LOCK");
}
