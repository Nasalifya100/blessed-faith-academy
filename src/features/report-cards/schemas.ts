import { z } from "zod";

export const generateClassDraftsSchema = z.object({
  academic_year_id: z.string().uuid(),
  term_id: z.string().uuid(),
  class_id: z.string().uuid(),
});

export const reportCardIdRevisionSchema = z.object({
  report_card_id: z.string().uuid(),
  expected_revision: z.number().int().positive(),
});

export const saveRemarksSchema = reportCardIdRevisionSchema.extend({
  teacher_remark: z.string().max(2000).optional(),
  headteacher_remark: z.string().max(2000).optional(),
  update_teacher: z.boolean().default(false),
  update_headteacher: z.boolean().default(false),
});

export const voidReportCardSchema = reportCardIdRevisionSchema.extend({
  reason: z.string().trim().min(3).max(500),
});

export const unpublishReportCardSchema = reportCardIdRevisionSchema.extend({
  reason: z.string().trim().max(500).optional(),
});

export const bulkIdsSchema = z.object({
  report_card_ids: z.array(z.string().uuid()).min(1).max(200),
});

export const updateReportCardSettingsSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  show_school_logo: z.boolean().optional(),
  show_admission_number: z.boolean().optional(),
  show_class_position: z.boolean().optional(),
  show_subject_position: z.boolean().optional(),
  show_grade_points: z.boolean().optional(),
  show_promotion_recommendation: z.boolean().optional(),
  show_attendance: z.boolean().optional(),
  show_teacher_remark: z.boolean().optional(),
  show_headteacher_remark: z.boolean().optional(),
  show_grading_key: z.boolean().optional(),
  show_generated_timestamp: z.boolean().optional(),
  require_teacher_remark_for_review: z.boolean().optional(),
  require_headteacher_remark_for_approve: z.boolean().optional(),
  footer_text: z.string().max(2000).nullable().optional(),
  ranking_disabled_message: z.string().trim().min(1).max(300).optional(),
});
