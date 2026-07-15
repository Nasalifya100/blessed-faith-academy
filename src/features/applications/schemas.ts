import { z } from "zod";

import { guardianSchema, GENDERS } from "@/features/students/schemas";

const dateString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      `Enter a valid ${label.toLowerCase()}`,
    );

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export const APPLICATION_STATUS_LABELS: Record<
  (typeof APPLICATION_STATUSES)[number],
  string
> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const createApplicationSchema = z
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
    applied_class_id: z.string().uuid("Please choose a class to apply for"),
    consent_agreed: z.boolean().refine((value) => value === true, {
      message: "The parent/guardian must agree to the declaration",
    }),
    consent_signed_by: z
      .string()
      .min(1, "Enter the name of the parent/guardian who agreed"),
    consent_signed_at: dateString("Declaration date"),
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

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const approveApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  class_id: z.string().uuid("Please choose a class"),
});

export const rejectApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  notes: z.string().optional().or(z.literal("")),
});
