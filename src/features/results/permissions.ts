import type { StaffRole } from "@/features/auth/types";
import { normalizeStaffRole } from "@/features/auth/permissions";
import {
  hasAcademicCapability,
  type AcademicCapability as BaseAcademicCapability,
} from "@/features/academics/permissions";

export type ResultsCapability =
  | BaseAcademicCapability
  | "RESULTS_VIEW"
  | "RESULTS_VIEW_ALL"
  | "RESULTS_RECALCULATE"
  | "PROMOTION_POLICIES_MANAGE"
  | "GRADEBOOK_ENTER"
  | "GRADEBOOK_VIEW_ALL";

const HEAD_RESULTS: readonly ResultsCapability[] = [
  "RESULTS_VIEW",
  "RESULTS_VIEW_ALL",
  "RESULTS_RECALCULATE",
  "PROMOTION_POLICIES_MANAGE",
] as const;

export function hasResultsCapability(
  role: StaffRole | string | null | undefined,
  capability: ResultsCapability,
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
    return (HEAD_RESULTS as readonly string[]).includes(capability);
  }

  if (capability === "RESULTS_VIEW") {
    return normalized === "teacher";
  }

  // Secretary/bursar: no default marks/results visibility.
  return false;
}

export function canOpenResults(
  role: StaffRole | string | null | undefined,
): boolean {
  return (
    hasResultsCapability(role, "RESULTS_VIEW") ||
    hasResultsCapability(role, "RESULTS_VIEW_ALL")
  );
}

export function canViewAllResults(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasResultsCapability(role, "RESULTS_VIEW_ALL");
}

export function canRecalculateResults(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasResultsCapability(role, "RESULTS_RECALCULATE");
}

export function canManagePromotionPolicies(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasResultsCapability(role, "PROMOTION_POLICIES_MANAGE");
}
