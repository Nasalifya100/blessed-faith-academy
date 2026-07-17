import { z } from "zod";

import { subKwacha, toNgwee } from "@/lib/money";
import {
  GENDERS,
  guardianSchema,
  mapGuardianPayload,
  studentExtraFieldsSchema,
} from "@/features/students/schemas";

/** Statuses allowed when migrating an existing pupil (not applicant/rejected). */
export const EXISTING_STUDENT_STATUSES = [
  "enrolled",
  "withdrawn",
  "graduated",
] as const;

export type ExistingStudentStatus = (typeof EXISTING_STUDENT_STATUSES)[number];

const optionalText = z.string().optional().or(z.literal(""));

const dateString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      `Enter a valid ${label.toLowerCase()}`,
    );

const moneyAmount = z.coerce
  .number({ error: "Enter a valid amount" })
  .refine((value) => Number.isFinite(value), "Enter a valid amount")
  .refine((value) => value >= 0, "Amount cannot be negative");

export const openingChargeLineSchema = z
  .object({
    fee_item_id: z.string().uuid("Select a fee type"),
    description: optionalText,
    original_amount: moneyAmount,
    previously_paid_amount: moneyAmount,
    academic_year_id: z.string().uuid("Select an academic year"),
    term_id: z.string().uuid().optional().or(z.literal("")),
    notes: optionalText,
  })
  .superRefine((line, ctx) => {
    if (toNgwee(line.previously_paid_amount) > toNgwee(line.original_amount)) {
      ctx.addIssue({
        code: "custom",
        message: "Previously paid cannot exceed the original amount",
        path: ["previously_paid_amount"],
      });
    }
  });

export type OpeningChargeLineInput = z.infer<typeof openingChargeLineSchema>;

/** Outstanding = original − previously paid (ngwee-safe). */
export function openingOutstanding(
  original: number,
  previouslyPaid: number,
): number {
  return subKwacha(original, previouslyPaid);
}

export function sumOpeningOutstanding(
  lines: readonly OpeningChargeLineInput[],
): number {
  let total = 0;
  for (const line of lines) {
    const outstanding = openingOutstanding(
      line.original_amount,
      line.previously_paid_amount,
    );
    if (toNgwee(outstanding) > 0) {
      total += toNgwee(outstanding);
    }
  }
  return total / 100;
}

/** Soft-warn when admission date is within this many days of today. */
export const RECENT_ADMISSION_WARN_DAYS = 60;

export function isRecentAdmissionDate(
  admissionDate: string,
  today = new Date(),
): boolean {
  const parsed = new Date(admissionDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const start = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
  );
  const admit = new Date(
    Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  );
  const diffDays = Math.floor(
    (start.getTime() - admit.getTime()) / (24 * 60 * 60 * 1000),
  );
  return diffDays >= 0 && diffDays <= RECENT_ADMISSION_WARN_DAYS;
}

export const createExistingStudentSchema = z
  .object({
    admission_number: z
      .string()
      .min(1, "Admission number is required")
      .transform((value) => value.trim().toUpperCase()),
    admission_date: dateString("Admission date").refine(
      (value) => new Date(value) <= new Date(),
      "Admission date cannot be in the future",
    ),
    legacy_reference: optionalText,
    status: z.enum(EXISTING_STUDENT_STATUSES),
    migration_notes: optionalText,
    first_name: z.string().min(1, "First name is required"),
    middle_name: optionalText,
    last_name: z.string().min(1, "Last name is required"),
    date_of_birth: dateString("Date of birth").refine(
      (value) => new Date(value) <= new Date(),
      "Date of birth cannot be in the future",
    ),
    gender: z.enum(GENDERS),
    class_id: z.string().uuid("Please choose a class"),
    placement_effective_date: dateString("Placement date").optional().or(z.literal("")),
    guardians: z
      .array(guardianSchema)
      .min(1, "Add at least one parent or guardian"),
    opening_charges: z.array(openingChargeLineSchema).default([]),
  })
  .merge(studentExtraFieldsSchema)
  .superRefine((data, ctx) => {
    if (
      data.guardians.filter((guardian) => guardian.is_primary_contact)
        .length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Mark exactly one guardian as the primary contact",
        path: ["guardians"],
      });
    }

    const keys = new Set<string>();
    data.opening_charges.forEach((line, index) => {
      const key = `${line.fee_item_id}:${line.academic_year_id}:${line.term_id || "year"}`;
      if (keys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate opening charge for the same fee type and period",
          path: ["opening_charges", index, "fee_item_id"],
        });
      }
      keys.add(key);
    });
  });

export type CreateExistingStudentInput = z.infer<
  typeof createExistingStudentSchema
>;

export function emptyOpeningChargeLine(
  academicYearId: string,
  feeItemId = "",
): OpeningChargeLineInput {
  return {
    fee_item_id: feeItemId,
    description: "",
    original_amount: 0,
    previously_paid_amount: 0,
    academic_year_id: academicYearId,
    term_id: "",
    notes: "",
  };
}

/** Payload for create_existing_student_migration — never includes payments. */
export function toExistingStudentRpcPayload(data: CreateExistingStudentInput) {
  return {
    admission_number: data.admission_number,
    admission_date: data.admission_date,
    legacy_reference: data.legacy_reference ?? "",
    status: data.status,
    migration_notes: data.migration_notes ?? "",
    first_name: data.first_name.trim(),
    middle_name: data.middle_name?.trim() ?? "",
    last_name: data.last_name.trim(),
    date_of_birth: data.date_of_birth,
    gender: data.gender,
    class_id: data.class_id,
    placement_effective_date:
      data.placement_effective_date?.trim() || data.admission_date,
    place_of_birth: data.place_of_birth ?? "",
    religious_denomination: data.religious_denomination ?? "",
    previous_school: data.previous_school ?? "",
    proposed_admission_date: data.proposed_admission_date ?? "",
    vaccinated_smallpox: data.vaccinated_smallpox ?? null,
    vaccination_date: data.vaccination_date ?? "",
    medical_notes: data.medical_notes ?? "",
    is_zambian_citizen: data.is_zambian_citizen ?? null,
    guardians: data.guardians.map(mapGuardianPayload),
    opening_charges: data.opening_charges.map((line) => ({
      fee_item_id: line.fee_item_id,
      description: line.description ?? "",
      original_amount: line.original_amount,
      previously_paid_amount: line.previously_paid_amount,
      academic_year_id: line.academic_year_id,
      term_id: line.term_id || "",
      notes: line.notes ?? "",
    })),
  };
}
