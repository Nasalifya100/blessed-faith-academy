import { z } from "zod";

export const EXAM_PERIOD_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
] as const;

/** Period CLOSED is shown to staff as Completed. */
export const EXAM_PERIOD_STATUS_LABELS: Record<
  (typeof EXAM_PERIOD_STATUSES)[number],
  string
> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CLOSED: "Completed",
  ARCHIVED: "Archived",
};

export const EXAM_LIFECYCLE_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "READY",
  "COMPLETED",
  "ARCHIVED",
] as const;

export const EXAM_LIFECYCLE_STATUS_LABELS: Record<
  (typeof EXAM_LIFECYCLE_STATUSES)[number],
  string
> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  READY: "Ready",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const EXAM_LIFECYCLE_HELP: Record<
  (typeof EXAM_LIFECYCLE_STATUSES)[number],
  string
> = {
  DRAFT: "Finish scheduling this exam before making it ready.",
  SCHEDULED: "The exam has a valid date and timetable.",
  READY: "Preparation is complete and the exam is ready to take place.",
  COMPLETED: "The exam has taken place and will be available for marks entry.",
  ARCHIVED: "Kept for history and hidden from normal active lists.",
};

/** Format: EX-{YEAR}-T{n|Y}-{####} */
export const EXAM_REFERENCE_PATTERN = /^EX-[0-9A-Z]{4,8}-T(?:[1-4]|Y)-\d{4}$/;

export function isValidExamReference(value: string): boolean {
  return EXAM_REFERENCE_PATTERN.test(value.trim().toUpperCase());
}

export const EXCLUSION_REASONS = [
  "MEDICAL",
  "TRANSFERRED",
  "ABSENT",
  "OTHER",
] as const;

export const EXCLUSION_REASON_LABELS: Record<
  (typeof EXCLUSION_REASONS)[number],
  string
> = {
  MEDICAL: "Medically exempt",
  TRANSFERRED: "Transferred",
  ABSENT: "Absent",
  OTHER: "Other",
};

const uuid = z.string().uuid("Choose a valid option.");

export const examPeriodSchema = z
  .object({
    id: uuid.optional().nullable(),
    academic_year_id: uuid,
    term_id: uuid.optional().nullable(),
    name: z.string().trim().min(1, "Exam period name is required.").max(120),
    description: z.string().trim().max(500).optional().nullable(),
    opens_on: z.string().optional().nullable(),
    closes_on: z.string().optional().nullable(),
    status: z.enum(EXAM_PERIOD_STATUSES).default("DRAFT"),
  })
  .superRefine((value, ctx) => {
    if (value.opens_on && value.closes_on && value.closes_on < value.opens_on) {
      ctx.addIssue({
        code: "custom",
        message: "Closing date must be on or after the opening date.",
        path: ["closes_on"],
      });
    }
  });

export const duplicateExamPeriodSchema = z.object({
  source_period_id: uuid,
  new_name: z.string().trim().min(1, "New name is required.").max(120),
  academic_year_id: uuid.optional().nullable(),
  term_id: uuid.optional().nullable(),
  copy_exams: z.boolean().default(true),
  copy_schedules: z.boolean().default(false),
});

export const examSchema = z.object({
  id: uuid.optional().nullable(),
  exam_period_id: uuid,
  subject_id: uuid,
  grade_level_id: uuid,
  class_id: uuid.optional().nullable(),
  assessment_type_id: uuid,
  max_marks: z.coerce
    .number()
    .positive("Maximum marks must be greater than zero.")
    .max(1000),
  instructions: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  cohort_scope: z.enum(["GRADE", "CLASS"]).default("GRADE"),
});

export const examScheduleSchema = z
  .object({
    exam_id: uuid,
    exam_date: z.string().min(1, "Date is required."),
    start_time: z.string().min(1, "Start time is required."),
    end_time: z.string().min(1, "End time is required."),
    room_id: uuid.optional().nullable(),
    primary_invigilator_id: uuid.optional().nullable(),
    assistant_invigilator_id: uuid.optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    capacity_override: z.coerce.number().int().positive().optional().nullable(),
    allow_warnings: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.end_time <= value.start_time) {
      ctx.addIssue({
        code: "custom",
        message: "End time must be after start time.",
        path: ["end_time"],
      });
    }
    if (
      value.primary_invigilator_id &&
      value.assistant_invigilator_id &&
      value.primary_invigilator_id === value.assistant_invigilator_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Primary and assistant invigilators must be different.",
        path: ["assistant_invigilator_id"],
      });
    }
  });

export const examRoomSchema = z.object({
  id: uuid.optional().nullable(),
  name: z.string().trim().min(1, "Room name is required.").max(80),
  capacity: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const examExclusionSchema = z.object({
  exam_id: uuid,
  student_id: uuid,
  reason: z.enum(EXCLUSION_REASONS).default("OTHER"),
  notes: z.string().trim().max(300).optional().nullable(),
});

export const saveTemplateSchema = z.object({
  period_id: uuid,
  template_name: z.string().trim().min(1, "Template name is required.").max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export const applyTemplateSchema = z.object({
  template_id: uuid,
  exam_period_id: uuid,
});

export const bulkShiftDatesSchema = z.object({
  exam_period_id: uuid,
  day_offset: z.coerce.number().int().refine((n) => n !== 0, {
    message: "Enter how many days to move (not zero).",
  }),
});

export const bulkAssignRoomSchema = z.object({
  exam_period_id: uuid,
  room_id: uuid,
});

export const transitionExamStatusSchema = z.object({
  exam_id: uuid,
  new_status: z.enum(EXAM_LIFECYCLE_STATUSES),
  reason: z.string().trim().max(300).optional().nullable(),
  force_future_complete: z.boolean().default(false),
});

export type ExamConflictWarning = {
  code: string;
  message: string;
  fix: string;
};

export function parseConflictWarnings(raw: unknown): ExamConflictWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        code: String(row.code ?? ""),
        message: String(row.message ?? ""),
        fix: String(row.fix ?? ""),
      };
    })
    .filter((x): x is ExamConflictWarning => Boolean(x?.message));
}
