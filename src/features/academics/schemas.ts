import { z } from "zod";

export const SUBJECT_CATEGORIES = [
  "CORE",
  "ELECTIVE",
  "OPTIONAL",
  "PRACTICAL",
  "CO_CURRICULAR",
] as const;

export const subjectSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, "Subject name is required").max(120),
  short_name: z.string().trim().max(40).optional().nullable(),
  code: z.string().trim().max(40).optional().nullable(),
  subject_category: z.enum(SUBJECT_CATEGORIES).default("CORE"),
  description: z.string().trim().max(500).optional().nullable(),
  display_order: z.coerce.number().int().min(0).max(9999).default(0),
  is_active: z.boolean().default(true),
});

export type SubjectInput = z.infer<typeof subjectSchema>;

export const createClassSchema = z.object({
  grade_level_id: z.string().uuid("Select a grade"),
  academic_year_id: z.string().uuid("Select an academic year"),
  name: z.string().trim().min(1, "Class name is required").max(80),
  stream_code: z.string().trim().max(10).optional().nullable(),
  capacity: z.coerce.number().int().positive().optional().nullable(),
});

export type CreateClassInput = z.infer<typeof createClassSchema>;

export const gradeOfferingItemSchema = z.object({
  subject_id: z.string().uuid(),
  is_compulsory: z.boolean().default(true),
});

export const bulkGradeOfferingsSchema = z.object({
  academic_year_id: z.string().uuid(),
  grade_level_id: z.string().uuid(),
  items: z.array(gradeOfferingItemSchema),
});

export const teachingAssignmentSchema = z.object({
  subject_offering_id: z.string().uuid("Select a subject offering"),
  staff_id: z.string().uuid("Select a teacher"),
  class_id: z.string().uuid().optional().nullable(),
});

export const gradingBandSchema = z
  .object({
    minimum_score: z.coerce.number(),
    maximum_score: z.coerce.number(),
    grade_code: z.string().trim().min(1).max(20),
    grade_label: z.string().trim().min(1).max(60),
    grade_point: z.coerce.number().optional().nullable(),
    performance_description: z.string().trim().max(200).optional().nullable(),
    is_pass: z.boolean().default(true),
    display_order: z.coerce.number().int().optional(),
  })
  .refine((b) => b.minimum_score <= b.maximum_score, {
    message: "Minimum cannot be greater than maximum",
    path: ["minimum_score"],
  });

export const gradingSchemeSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, "Name is required").max(120),
  bands: z.array(gradingBandSchema).min(1, "Add at least one grade band"),
  make_default: z.boolean().default(true),
  confirm: z.boolean().default(false),
});

export function bandsOverlap(
  bands: Array<{ minimum_score: number; maximum_score: number }>,
): boolean {
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i];
      const b = bands[j];
      if (
        a.minimum_score <= b.maximum_score &&
        b.minimum_score <= a.maximum_score
      ) {
        return true;
      }
    }
  }
  return false;
}

export function weightTotal(
  items: Array<{ weight_percentage: number }>,
): number {
  return items.reduce((sum, i) => sum + Number(i.weight_percentage || 0), 0);
}

export const weightItemSchema = z.object({
  assessment_type_id: z.string().uuid(),
  weight_percentage: z.coerce.number().min(0).max(100),
  display_order: z.coerce.number().int().optional(),
});

export const weightSchemeSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    name: z.string().trim().min(1).max(120),
    items: z.array(weightItemSchema).min(1),
    make_default: z.boolean().default(true),
    confirm: z.boolean().default(false),
    academic_year_id: z.string().uuid().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const total = weightTotal(data.items);
    if (Math.abs(total - 100) > 0.001) {
      ctx.addIssue({
        code: "custom",
        message: `Weights must total exactly 100% (currently ${total}%).`,
        path: ["items"],
      });
    }
  });

export const workflowPeriodSchema = z.object({
  academic_year_id: z.string().uuid(),
  term_id: z.string().uuid().optional().nullable(),
  workflow_type: z.enum([
    "MARKS_ENTRY",
    "MODERATION",
    "APPROVAL",
    "PUBLICATION",
  ]),
  starts_at: z.string().min(1, "Start date is required"),
  ends_at: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

/** Recommended default bands (editable — not locked school policy). */
export const RECOMMENDED_GRADING_BANDS = [
  {
    minimum_score: 80,
    maximum_score: 100,
    grade_code: "D",
    grade_label: "Distinction",
    is_pass: true,
    display_order: 1,
  },
  {
    minimum_score: 70,
    maximum_score: 79.99,
    grade_code: "M",
    grade_label: "Merit",
    is_pass: true,
    display_order: 2,
  },
  {
    minimum_score: 60,
    maximum_score: 69.99,
    grade_code: "C",
    grade_label: "Credit",
    is_pass: true,
    display_order: 3,
  },
  {
    minimum_score: 50,
    maximum_score: 59.99,
    grade_code: "P",
    grade_label: "Pass",
    is_pass: true,
    display_order: 4,
  },
  {
    minimum_score: 0,
    maximum_score: 49.99,
    grade_code: "F",
    grade_label: "Fail",
    is_pass: false,
    display_order: 5,
  },
] as const;

export const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  MARKS_ENTRY: "Marks entry",
  MODERATION: "Moderation",
  APPROVAL: "Approval",
  PUBLICATION: "Results publication",
};

export const SUBJECT_CATEGORY_LABELS: Record<
  (typeof SUBJECT_CATEGORIES)[number],
  string
> = {
  CORE: "Core",
  ELECTIVE: "Elective",
  OPTIONAL: "Optional",
  PRACTICAL: "Practical",
  CO_CURRICULAR: "Co-curricular",
};
