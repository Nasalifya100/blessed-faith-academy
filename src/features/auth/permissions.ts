import type { StaffRole } from "@/features/auth/types";

/** Roles that may manage students, applications, and medical records. */
export const STUDENT_MANAGER_ROLES: readonly StaffRole[] = [
  "administrator",
  "headteacher",
  "secretary",
] as const;

/** Roles that may manage fees, charges, and payments. */
export const FEE_MANAGER_ROLES: readonly StaffRole[] = [
  "administrator",
  "bursar",
  "headteacher",
] as const;

/** Directory / list access (managers + bursar for fee look-ups). */
export const STUDENT_DIRECTORY_ROLES: readonly StaffRole[] = [
  ...STUDENT_MANAGER_ROLES,
  "bursar",
] as const;

/** Profile access includes teachers (discipline / attendance context). */
export const STUDENT_PROFILE_ROLES: readonly StaffRole[] = [
  ...STUDENT_DIRECTORY_ROLES,
  "teacher",
] as const;

export function canManageStudents(role: StaffRole | null | undefined): boolean {
  return Boolean(role && STUDENT_MANAGER_ROLES.includes(role));
}

export function canManageFees(role: StaffRole | null | undefined): boolean {
  return Boolean(role && FEE_MANAGER_ROLES.includes(role));
}

/**
 * Full “Add Existing Student” migration (student create + opening charges).
 * Requires both student-management and fee-management roles.
 */
export function canMigrateExistingStudents(
  role: StaffRole | null | undefined,
): boolean {
  return canManageStudents(role) && canManageFees(role);
}

/** Browse the Students list and search directory. */
export function canBrowseStudents(role: StaffRole | null | undefined): boolean {
  return Boolean(role && STUDENT_DIRECTORY_ROLES.includes(role));
}

/** Open an individual student profile. */
export function canViewStudentProfile(
  role: StaffRole | null | undefined,
): boolean {
  return Boolean(role && STUDENT_PROFILE_ROLES.includes(role));
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
