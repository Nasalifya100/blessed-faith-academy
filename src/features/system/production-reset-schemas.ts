import { z } from "zod";

export const PRODUCTION_RESET_SCHOOL_NAME = "Blessed Faith Academy";
export const PRODUCTION_RESET_CONFIRMATION = "RESET BFA PRODUCTION DATA";

export const productionResetConfirmSchema = z.object({
  schoolName: z
    .string()
    .refine(
      (value) => value === PRODUCTION_RESET_SCHOOL_NAME,
      "School name confirmation is incorrect.",
    ),
  confirmation: z
    .string()
    .refine(
      (value) => value === PRODUCTION_RESET_CONFIRMATION,
      "Confirmation phrase is incorrect.",
    ),
  understood: z.literal(true, {
    message: "You must confirm you understand this action is permanent.",
  }),
});

export type ProductionResetConfirmInput = z.infer<
  typeof productionResetConfirmSchema
>;

export type ProductionResetCounts = {
  attendance_record_audits: number;
  attendance_records: number;
  discipline_incidents: number;
  student_requirement_checks: number;
  student_medical: number;
  applications: number;
  student_class_enrollments: number;
  student_guardians: number;
  payments: number;
  charges: number;
  legacy_migration_audits: number;
  students: number;
  guardians: number;
  class_attendance_covers: number;
};

export type ProductionResetPreserved = {
  schools: number;
  profiles: number;
  academic_years: number;
  terms: number;
  grade_levels: number;
  classes: number;
  fee_items: number;
  fee_schedules: number;
  requirement_items: number;
  school_rules: number;
};

export type ProductionResetResult = {
  mode: "dry_run" | "executed";
  to_delete?: ProductionResetCounts;
  deleted?: ProductionResetCounts;
  preserved: ProductionResetPreserved;
  validation?: Record<string, number | boolean>;
  storage_candidates: unknown[];
  storage_note?: string;
  reminder?: string;
};

export function isValidProductionResetConfirmation(
  schoolName: string,
  confirmation: string,
): boolean {
  return (
    schoolName === PRODUCTION_RESET_SCHOOL_NAME &&
    confirmation === PRODUCTION_RESET_CONFIRMATION
  );
}
