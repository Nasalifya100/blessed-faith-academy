import { z } from "zod";

export const recalculateClassTermSchema = z.object({
  academic_year_id: z.string().uuid(),
  term_id: z.string().uuid(),
  class_id: z.string().uuid(),
});

export type RecalculateClassTermInput = z.infer<
  typeof recalculateClassTermSchema
>;

export const resultsFilterSchema = z.object({
  academic_year_id: z.string().uuid().optional().nullable(),
  term_id: z.string().uuid().optional().nullable(),
  class_id: z.string().uuid().optional().nullable(),
  subject_id: z.string().uuid().optional().nullable(),
  student_id: z.string().uuid().optional().nullable(),
});
