import { z } from "zod";

export const GENDERS = ["male", "female"] as const;

export const GUARDIAN_RELATIONSHIPS = [
  "father",
  "mother",
  "guardian",
  "grandparent",
  "other",
] as const;

export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  male: "Male",
  female: "Female",
};

export const STUDENT_STATUSES = [
  "applicant",
  "enrolled",
  "withdrawn",
  "graduated",
  "rejected",
] as const;

export const STUDENT_STATUS_LABELS: Record<
  (typeof STUDENT_STATUSES)[number],
  string
> = {
  applicant: "Applicant",
  enrolled: "Enrolled",
  withdrawn: "Withdrawn",
  graduated: "Graduated",
  rejected: "Rejected",
};

export const RELATIONSHIP_LABELS: Record<
  (typeof GUARDIAN_RELATIONSHIPS)[number],
  string
> = {
  father: "Father",
  mother: "Mother",
  guardian: "Guardian",
  grandparent: "Grandparent",
  other: "Other",
};

/** Exact declaration clauses from the Blessed Faith Academy Enrollment Form. */
export const DECLARATION_CLAUSES = [
  "The child will attend classes and school functions punctually.",
  "The child will wear the correct school uniform at all times.",
  "The child will participate in sports and co-curricular activities.",
  "The child will follow school rules and be subject to school discipline.",
  "I accept full responsibility for paying fees and other expenses.",
] as const;

const optionalText = z.string().optional().or(z.literal(""));

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

export const guardianSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  phone: optionalText,
  alt_phone: optionalText,
  whatsapp: optionalText,
  email: z
    .string()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
  national_id: optionalText,
  occupation: optionalText,
  address: optionalText,
  postal_address: optionalText,
  is_primary_contact: z.boolean(),
  is_emergency_contact: z.boolean(),
  /** Confirmed sibling reuse; phone matches never auto-apply without this. */
  existing_guardian_id: z.string().uuid().optional().or(z.literal("")),
});

export type GuardianInput = z.infer<typeof guardianSchema>;

/** Extra child fields from the official enrolment form (all optional). */
export const studentExtraFieldsSchema = z.object({
  place_of_birth: optionalText,
  religious_denomination: optionalText,
  previous_school: optionalText,
  proposed_admission_date: optionalDate,
  vaccinated_smallpox: z.boolean().optional(),
  vaccination_date: optionalDate,
  medical_notes: optionalText,
  is_zambian_citizen: z.boolean().optional(),
});

export const createStudentSchema = z
  .object({
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
    class_id: z.string().uuid("Please choose a class"),
    guardians: z
      .array(guardianSchema)
      .min(1, "Add at least one parent or guardian"),
  })
  .merge(studentExtraFieldsSchema)
  .refine(
    (data) =>
      data.guardians.filter((guardian) => guardian.is_primary_contact)
        .length === 1,
    {
      message: "Mark exactly one guardian as the primary contact",
      path: ["guardians"],
    },
  );

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export function mapGuardianPayload(guardian: GuardianInput) {
  return {
    first_name: guardian.first_name.trim(),
    last_name: guardian.last_name.trim(),
    relationship: guardian.relationship,
    phone: guardian.phone ?? "",
    alt_phone: guardian.alt_phone ?? "",
    whatsapp: guardian.whatsapp ?? "",
    email: guardian.email ?? "",
    national_id: guardian.national_id ?? "",
    occupation: guardian.occupation ?? "",
    address: guardian.address ?? "",
    postal_address: guardian.postal_address ?? "",
    is_primary_contact: guardian.is_primary_contact,
    is_emergency_contact: guardian.is_emergency_contact,
    existing_guardian_id: guardian.existing_guardian_id?.trim() || "",
  };
}

export function emptyGuardian(isPrimary: boolean): GuardianInput {
  return {
    first_name: "",
    last_name: "",
    relationship: "mother",
    phone: "",
    alt_phone: "",
    whatsapp: "",
    email: "",
    national_id: "",
    occupation: "",
    address: "",
    postal_address: "",
    is_primary_contact: isPrimary,
    is_emergency_contact: false,
    existing_guardian_id: "",
  };
}

export const archiveStudentSchema = z.object({
  studentId: z.string().uuid(),
  reason: z.string().optional().or(z.literal("")),
});

export type ArchiveStudentInput = z.infer<typeof archiveStudentSchema>;

export const transferStudentClassSchema = z.object({
  studentId: z.string().uuid(),
  newClassId: z.string().uuid("Please choose a class"),
});

export type TransferStudentClassInput = z.infer<
  typeof transferStudentClassSchema
>;
