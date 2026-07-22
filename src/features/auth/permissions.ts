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

const ALL_STAFF_ROLES: readonly StaffRole[] = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
] as const;

/**
 * Normalize a profile role from the DB / claims so casing or whitespace
 * never hides Administrator actions.
 */
export function normalizeStaffRole(
  role: string | null | undefined,
): StaffRole | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase();
  return (ALL_STAFF_ROLES as readonly string[]).includes(normalized)
    ? (normalized as StaffRole)
    : null;
}

export function canManageStudents(role: StaffRole | null | undefined): boolean {
  const normalized = normalizeStaffRole(role);
  return Boolean(normalized && STUDENT_MANAGER_ROLES.includes(normalized));
}

export function canManageFees(role: StaffRole | null | undefined): boolean {
  const normalized = normalizeStaffRole(role);
  return Boolean(normalized && FEE_MANAGER_ROLES.includes(normalized));
}

/**
 * Full “Add Existing Student” migration (student create + opening charges).
 * Requires both student-management and fee-management roles
 * (administrator and headteacher).
 */
export function canMigrateExistingStudents(
  role: StaffRole | null | undefined,
): boolean {
  return canManageStudents(role) && canManageFees(role);
}

/** Browse the Students list and search directory. */
export function canBrowseStudents(role: StaffRole | null | undefined): boolean {
  const normalized = normalizeStaffRole(role);
  return Boolean(normalized && STUDENT_DIRECTORY_ROLES.includes(normalized));
}

/** Open an individual student profile. */
export function canViewStudentProfile(
  role: StaffRole | null | undefined,
): boolean {
  const normalized = normalizeStaffRole(role);
  return Boolean(normalized && STUDENT_PROFILE_ROLES.includes(normalized));
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

/** Production Reset is Administrator-only. */
export function canRunProductionReset(
  role: StaffRole | null | undefined,
): boolean {
  return normalizeStaffRole(role) === "administrator";
}

/** Finance allocation migration status is Administrator-only (read-only). */
export function canViewFinanceMigrationStatus(
  role: StaffRole | null | undefined,
): boolean {
  return normalizeStaffRole(role) === "administrator";
}

/** Server-only env gate (never NEXT_PUBLIC). */
export function isProductionResetEnvEnabled(): boolean {
  return process.env.ALLOW_PRODUCTION_RESET === "true";
}
