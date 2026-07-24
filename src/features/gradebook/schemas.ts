import { z } from "zod";

export const GRADEBOOK_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "REOPENED",
  "LOCKED",
] as const;

export type GradebookStatus = (typeof GRADEBOOK_STATUSES)[number];

export const RESULT_ENTRY_STATUSES = [
  "SCORED",
  "ABSENT",
  "EXEMPT",
  "NOT_ASSESSED",
] as const;

export type ResultEntryStatus = (typeof RESULT_ENTRY_STATUSES)[number];

export const GRADEBOOK_STATUS_LABELS: Record<GradebookStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  REOPENED: "Reopened",
  LOCKED: "Locked",
};

export const RESULT_ENTRY_STATUS_LABELS: Record<ResultEntryStatus, string> = {
  SCORED: "Scored",
  ABSENT: "Absent",
  EXEMPT: "Exempt",
  NOT_ASSESSED: "Not assessed",
};

const uuid = z.string().uuid();

export const gradebookResultRowSchema = z
  .object({
    student_id: uuid,
    entry_status: z.enum(RESULT_ENTRY_STATUSES),
    marks_obtained: z.number().finite().optional().nullable(),
    comment: z.string().max(500).optional().nullable(),
  })
  .superRefine((row, ctx) => {
    if (row.entry_status === "SCORED") {
      if (row.marks_obtained == null || Number.isNaN(row.marks_obtained)) {
        ctx.addIssue({
          code: "custom",
          message: "Scored entries require a mark.",
          path: ["marks_obtained"],
        });
      } else if (row.marks_obtained < 0) {
        ctx.addIssue({
          code: "custom",
          message: "Marks cannot be negative.",
          path: ["marks_obtained"],
        });
      }
    } else if (row.marks_obtained != null) {
      ctx.addIssue({
        code: "custom",
        message: "Non-scored statuses cannot include a mark.",
        path: ["marks_obtained"],
      });
    }
  });

export const saveGradebookDraftSchema = z.object({
  gradebook_id: uuid,
  expected_revision: z.number().int().positive(),
  /** Partial upsert: only listed students are written; omitted rows are kept. */
  rows: z.array(gradebookResultRowSchema).min(1),
}).superRefine((payload, ctx) => {
  const seen = new Set<string>();
  for (const [index, row] of payload.rows.entries()) {
    if (seen.has(row.student_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate student rows in one payload are not allowed.",
        path: ["rows", index, "student_id"],
      });
    }
    seen.add(row.student_id);
  }
});

export const submitGradebookSchema = z.object({
  gradebook_id: uuid,
  expected_revision: z.number().int().positive(),
});

export const reopenGradebookSchema = z.object({
  gradebook_id: uuid,
  expected_revision: z.number().int().positive(),
  reason: z.string().trim().min(3, "A reopening reason is required."),
});

export const lockGradebookSchema = z.object({
  gradebook_id: uuid,
  expected_revision: z.number().int().positive(),
});

export const getGradebookSchema = z.object({
  gradebook_id: uuid,
});

export const openGradebookSchema = z.object({
  exam_id: uuid,
  class_id: uuid,
});

export type GradebookResultRowInput = z.infer<typeof gradebookResultRowSchema>;
export type SaveGradebookDraftInput = z.infer<typeof saveGradebookDraftSchema>;

/** Client-side max-mark check (server always re-validates against exam.max_marks). */
export function marksWithinMaximum(
  marks: number | null | undefined,
  maxMarks: number,
): boolean {
  if (marks == null) return true;
  return marks >= 0 && marks <= maxMarks;
}
