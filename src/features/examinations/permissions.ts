import type { StaffRole } from "@/features/auth/types";
import { normalizeStaffRole } from "@/features/auth/permissions";
import {
  hasAcademicCapability as hasBaseAcademicCapability,
  type AcademicCapability as BaseAcademicCapability,
} from "@/features/academics/permissions";

export type ExamCapability =
  | BaseAcademicCapability
  | "EXAM_VIEW"
  | "EXAM_ROOMS_MANAGE"
  | "EXAM_PERIODS_MANAGE"
  | "EXAMS_MANAGE"
  | "EXAM_SCHEDULE_MANAGE"
  | "EXAM_TEMPLATES_MANAGE";

const HEAD_EXAM: readonly ExamCapability[] = [
  "EXAM_VIEW",
  "EXAM_ROOMS_MANAGE",
  "EXAM_PERIODS_MANAGE",
  "EXAMS_MANAGE",
  "EXAM_SCHEDULE_MANAGE",
  "EXAM_TEMPLATES_MANAGE",
] as const;

export function hasExamCapability(
  role: StaffRole | string | null | undefined,
  capability: ExamCapability,
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
    return hasBaseAcademicCapability(
      role,
      capability as BaseAcademicCapability,
    );
  }

  if (normalized === "headteacher") {
    return (HEAD_EXAM as readonly string[]).includes(capability);
  }

  if (capability === "EXAM_VIEW") {
    return ["teacher", "secretary", "bursar", "headteacher"].includes(
      normalized,
    );
  }

  return false;
}

export function canOpenExaminations(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasExamCapability(role, "EXAM_VIEW");
}

export function canManageExamSetup(
  role: StaffRole | string | null | undefined,
): boolean {
  return (
    hasExamCapability(role, "EXAM_PERIODS_MANAGE") ||
    hasExamCapability(role, "EXAMS_MANAGE")
  );
}
