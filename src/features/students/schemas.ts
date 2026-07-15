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

const dateString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((value) => !Number.isNaN(Date.parse(value)), `Enter a valid ${label.toLowerCase()}`);

export const guardianSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  phone: z.string().optional().or(z.literal("")),
  alt_phone: z.string().optional().or(z.literal("")),
  email: z
    .string()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
  national_id: z.string().optional().or(z.literal("")),
  occupation: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  is_primary_contact: z.boolean(),
  is_emergency_contact: z.boolean(),
});

export type GuardianInput = z.infer<typeof guardianSchema>;

export const createStudentSchema = z
  .object({
    admission_number: z.string().min(1, "Admission number is required"),
    first_name: z.string().min(1, "First name is required"),
    middle_name: z.string().optional().or(z.literal("")),
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
