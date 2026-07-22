import { z } from "zod";

import {
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  GENDER_LABELS,
} from "@/features/students/schemas";

export const PROFILE_CHANGE_REASONS = [
  "typing_error",
  "parent_guardian_request",
  "official_document_update",
  "contact_information_update",
  "guardian_responsibility_change",
  "other",
] as const;

export type ProfileChangeReason = (typeof PROFILE_CHANGE_REASONS)[number];

export const PROFILE_CHANGE_REASON_LABELS: Record<ProfileChangeReason, string> =
  {
    typing_error: "Typing error",
    parent_guardian_request: "Parent / guardian request",
    official_document_update: "Official document update",
    contact_information_update: "Contact information update",
    guardian_responsibility_change: "Guardian responsibility change",
    other: "Other",
  };

/** Soft Zambia-friendly phone check: optional, but if present must look usable. */
const optionalPhone = z
  .string()
  .optional()
  .or(z.literal(""))
  .refine((value) => {
    if (!value || !value.trim()) return true;
    const digits = value.replace(/\D/g, "");
    return digits.length >= 9 && digits.length <= 15;
  }, "Enter a valid phone number (at least 9 digits)");

const optionalText = z.string().optional().or(z.literal(""));

const optionalEmail = z
  .string()
  .email("Enter a valid email address")
  .optional()
  .or(z.literal(""));

const dateString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      `Enter a valid ${label.toLowerCase()}`,
    );

const optionalDate = z
  .string()
  .optional()
  .or(z.literal(""))
  .refine(
    (value) => !value || !Number.isNaN(Date.parse(value)),
    "Enter a valid date",
  );

const changeReasonFields = {
  change_reason: z.enum(PROFILE_CHANGE_REASONS),
  change_note: optionalText,
};

function refineOtherNote<
  T extends { change_reason: ProfileChangeReason; change_note?: string },
>(data: T, ctx: z.RefinementCtx) {
  if (
    data.change_reason === "other" &&
    !(data.change_note && data.change_note.trim())
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Add a note when the reason is Other",
      path: ["change_note"],
    });
  }
}

export const updateStudentProfileSchema = z
  .object({
    student_id: z.string().uuid(),
    admission_number: z
      .string()
      .min(1, "Admission number is required")
      .transform((value) => value.trim().toUpperCase()),
    first_name: z.string().min(1, "First name is required"),
    middle_name: optionalText,
    last_name: z.string().min(1, "Last name is required"),
    date_of_birth: dateString("Date of birth").refine(
      (value) => new Date(value) <= new Date(),
      "Date of birth cannot be in the future",
    ),
    gender: z.enum(GENDERS),
    enrollment_date: dateString("Enrollment date"),
    place_of_birth: optionalText,
    religious_denomination: optionalText,
    previous_school: optionalText,
    proposed_admission_date: optionalDate,
    is_zambian_citizen: z.boolean().nullable().optional(),
    medical_notes: optionalText,
    vaccinated_smallpox: z.boolean().nullable().optional(),
    vaccination_date: optionalDate,
    ...changeReasonFields,
  })
  .superRefine(refineOtherNote);

export type UpdateStudentProfileInput = z.infer<
  typeof updateStudentProfileSchema
>;

export const updateGuardianProfileSchema = z
  .object({
    student_id: z.string().uuid(),
    guardian_id: z.string().uuid(),
    first_name: z.string().min(1, "First name is required"),
    last_name: z.string().min(1, "Last name is required"),
    phone: optionalPhone,
    alt_phone: optionalPhone,
    whatsapp: optionalPhone,
    email: optionalEmail,
    national_id: optionalText,
    occupation: optionalText,
    address: optionalText,
    postal_address: optionalText,
    relationship: z.enum(GUARDIAN_RELATIONSHIPS),
    is_primary_contact: z.boolean(),
    is_emergency_contact: z.boolean(),
    ...changeReasonFields,
  })
  .superRefine(refineOtherNote);

export type UpdateGuardianProfileInput = z.infer<
  typeof updateGuardianProfileSchema
>;

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  admission_number: "Admission number",
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  gender: "Gender",
  enrollment_date: "Enrollment date",
  place_of_birth: "Place of birth",
  religious_denomination: "Religious denomination",
  previous_school: "Present / last school",
  proposed_admission_date: "Proposed admission date",
  is_zambian_citizen: "Zambian citizen",
  medical_notes: "Medical notes / allergies",
  vaccinated_smallpox: "Vaccinated (smallpox)",
  vaccination_date: "Vaccination date",
  phone: "Guardian phone number",
  alt_phone: "Alternate phone",
  whatsapp: "WhatsApp number",
  email: "Email address",
  national_id: "NRC / national ID",
  occupation: "Occupation",
  address: "Residential address",
  postal_address: "Postal address",
  relationship: "Relationship to pupil",
  is_primary_contact: "Primary contact",
  is_emergency_contact: "Emergency contact",
};

export const SENSITIVE_PROFILE_FIELDS = new Set([
  "medical_notes",
  "vaccinated_smallpox",
  "vaccination_date",
  "national_id",
  "phone",
  "alt_phone",
  "whatsapp",
  "email",
  "address",
  "postal_address",
]);

export const MEDICAL_PROFILE_FIELDS = new Set([
  "medical_notes",
  "vaccinated_smallpox",
  "vaccination_date",
]);

export function fieldLabel(fieldName: string, fallback?: string | null): string {
  return (
    PROFILE_FIELD_LABELS[fieldName] ??
    fallback ??
    fieldName.replaceAll("_", " ")
  );
}

export function reasonLabel(reason: string): string {
  if (reason in PROFILE_CHANGE_REASON_LABELS) {
    return PROFILE_CHANGE_REASON_LABELS[reason as ProfileChangeReason];
  }
  if (reason === "system_direct") {
    return "System / direct database update";
  }
  return reason.replaceAll("_", " ");
}

/** Mask sensitive display values for roles that should not see full data. */
export function maskSensitiveValue(
  value: string | null,
  fieldName: string,
): string {
  if (value == null || value === "") return "—";
  if (MEDICAL_PROFILE_FIELDS.has(fieldName)) {
    return "•••• (restricted)";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `******${digits.slice(-4)}`;
  }
  if (value.length <= 2) return "••••";
  return `******${value.slice(-2)}`;
}

export function formatProfileAuditValue(
  value: string | null,
  fieldName: string,
): string {
  if (value == null || value === "") return "—";
  if (fieldName === "gender") {
    return (GENDER_LABELS as Record<string, string>)[value] ?? value;
  }
  return value;
}

/**
 * Pure helpers for tests: compare normalized editable maps and build
 * audit-shaped diffs without touching the database.
 */
export function normalizeComparable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function buildFieldDiffs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Array<{ field_name: string; old_value: string | null; new_value: string | null }> {
  const diffs: Array<{
    field_name: string;
    old_value: string | null;
    new_value: string | null;
  }> = [];

  for (const field of fields) {
    const oldValue = normalizeComparable(before[field]);
    const newValue = normalizeComparable(after[field]);
    if (oldValue === newValue) continue;
    diffs.push({ field_name: field, old_value: oldValue, new_value: newValue });
  }

  return diffs;
}

export const STUDENT_EDITABLE_FIELDS = [
  "admission_number",
  "first_name",
  "middle_name",
  "last_name",
  "date_of_birth",
  "gender",
  "enrollment_date",
  "place_of_birth",
  "religious_denomination",
  "previous_school",
  "proposed_admission_date",
  "is_zambian_citizen",
  "medical_notes",
  "vaccinated_smallpox",
  "vaccination_date",
] as const;

export const GUARDIAN_EDITABLE_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "alt_phone",
  "whatsapp",
  "email",
  "national_id",
  "occupation",
  "address",
  "postal_address",
  "relationship",
  "is_primary_contact",
  "is_emergency_contact",
] as const;
