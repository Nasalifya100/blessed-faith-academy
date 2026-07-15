import { z } from "zod";

export const DISCIPLINE_SEVERITIES = ["low", "medium", "high"] as const;
export type DisciplineSeverity = (typeof DISCIPLINE_SEVERITIES)[number];

export const DISCIPLINE_SEVERITY_LABELS: Record<DisciplineSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const DISCIPLINE_STATUSES = ["open", "resolved"] as const;
export type DisciplineStatus = (typeof DISCIPLINE_STATUSES)[number];

export const DISCIPLINE_STATUS_LABELS: Record<DisciplineStatus, string> = {
  open: "Open",
  resolved: "Resolved",
};

export const createDisciplineIncidentSchema = z.object({
  studentId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional().or(z.literal("")),
  actionTaken: z.string().optional().or(z.literal("")),
  severity: z.enum(DISCIPLINE_SEVERITIES),
  incidentDate: z
    .string()
    .min(1, "Date is required")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date"),
  relatedRuleId: z.string().uuid().optional().nullable().or(z.literal("")),
});

export type CreateDisciplineIncidentInput = z.infer<
  typeof createDisciplineIncidentSchema
>;

export const resolveDisciplineIncidentSchema = z.object({
  incidentId: z.string().uuid(),
  studentId: z.string().uuid(),
  actionTaken: z.string().optional().or(z.literal("")),
});

export const updateSchoolRuleSchema = z.object({
  ruleId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required"),
  body: z.string().trim().min(1, "Rule text is required"),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export type UpdateSchoolRuleInput = z.infer<typeof updateSchoolRuleSchema>;
