import { z } from "zod";

export const FEE_CATEGORIES = [
  "tuition",
  "extra",
  "meal",
  "uniform",
] as const;

export const FEE_CATEGORY_LABELS: Record<(typeof FEE_CATEGORIES)[number], string> =
  {
    tuition: "Tuition",
    extra: "Extra fees",
    meal: "Meals",
    uniform: "Uniforms",
  };

export const BILLING_FREQUENCY_LABELS: Record<string, string> = {
  term: "Per term",
  year: "Per year",
  once: "Once",
  monthly: "Monthly",
  weekly: "Weekly",
};

export const REQUIREMENT_BAND_LABELS: Record<string, string> = {
  preschool: "Pre-school (Baby–Pre-grade)",
  lower: "Lower primary (Grade 1–4)",
  upper: "Upper primary (Grade 5–7)",
  all: "All grades",
};

export const updateScheduleAmountSchema = z.object({
  scheduleId: z.string().uuid(),
  amount: z.number().min(0, "Amount cannot be negative"),
});

export type UpdateScheduleAmountInput = z.infer<
  typeof updateScheduleAmountSchema
>;

export const generateStudentChargesSchema = z.object({
  studentId: z.string().uuid(),
  termId: z.string().uuid().optional(),
});

export const generateClassChargesSchema = z.object({
  classId: z.string().uuid(),
  termId: z.string().uuid().optional(),
});

export const PAYMENT_METHODS = ["mobile_money", "bank_transfer"] as const;

export const PAYMENT_METHOD_LABELS: Record<
  (typeof PAYMENT_METHODS)[number],
  string
> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
};

export const recordPaymentSchema = z.object({
  studentId: z.string().uuid(),
  amount: z.number().positive("Amount must be greater than zero"),
  method: z.enum(PAYMENT_METHODS),
  reference_number: z.string().optional().or(z.literal("")),
  paid_on: z
    .string()
    .min(1, "Payment date is required")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date"),
  notes: z.string().optional().or(z.literal("")),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const optInOptionalFeesSchema = z.object({
  studentId: z.string().uuid(),
  termId: z.string().uuid().optional(),
  mealFeeItemId: z.string().uuid().optional().nullable(),
  uniformFeeItemIds: z.array(z.string().uuid()).default([]),
});

export type OptInOptionalFeesInput = z.infer<typeof optInOptionalFeesSchema>;

export const setRequirementReceivedSchema = z.object({
  studentId: z.string().uuid(),
  requirementItemId: z.string().uuid(),
  isReceived: z.boolean(),
  notes: z.string().optional().or(z.literal("")),
});

export type SetRequirementReceivedInput = z.infer<
  typeof setRequirementReceivedSchema
>;

export const cancelOptionalChargeSchema = z.object({
  chargeId: z.string().uuid(),
  studentId: z.string().uuid(),
});

export type CancelOptionalChargeInput = z.infer<
  typeof cancelOptionalChargeSchema
>;
