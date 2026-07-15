import type { StaffRole } from "@/features/auth/types";

/** Roles that may manage students, applications, and medical records. */
export const STUDENT_MANAGER_ROLES: readonly StaffRole[] = [
  "administrator",
  "headteacher",
  "secretary",
] as const;

export function canManageStudents(role: StaffRole | null | undefined): boolean {
  return Boolean(role && STUDENT_MANAGER_ROLES.includes(role));
}

/** Alias: medical data is limited to student managers. */
export function canViewStudentMedical(
  role: StaffRole | null | undefined,
): boolean {
  return canManageStudents(role);
}

export function canManageApplications(
  role: StaffRole | null | undefined,
): boolean {
  return canManageStudents(role);
}
