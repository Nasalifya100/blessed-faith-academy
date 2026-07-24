import type { GradebookStatus, ResultEntryStatus } from "./schemas";

export interface GradebookRosterRow {
  student_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  student_status: string;
}

export interface GradebookResultRow {
  id: string;
  student_id: string;
  entry_status: ResultEntryStatus;
  marks_obtained: number | null;
  max_marks_snapshot: number;
  comment: string | null;
  row_revision: number;
}

export interface ExamGradebookSummary {
  id: string;
  exam_id: string;
  class_id: string;
  status: GradebookStatus;
  revision: number;
  opened_by: string | null;
  opened_at: string;
  last_saved_at: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  reopened_at: string | null;
  reopening_reason: string | null;
  locked_at: string | null;
  locked_by?: string | null;
  created?: boolean;
}

export interface OpenExamGradebookResponse {
  gradebook: ExamGradebookSummary;
  exam: {
    id: string;
    exam_reference: string;
    status: string;
    subject_id: string;
    grade_level_id: string;
    max_marks: number;
    assessment_type_id: string;
    academic_year_id: string;
    term_id: string | null;
  };
  roster: GradebookRosterRow[];
  results: GradebookResultRow[];
  can_edit: boolean;
}

export interface SaveGradebookDraftResponse {
  gradebook_id: string;
  revision: number;
  saved_count: number;
  status: GradebookStatus;
}

export interface SubmitGradebookResponse {
  gradebook_id: string;
  status: GradebookStatus;
  revision: number;
  submitted_at: string;
  roster_count: number;
  pruned_ineligible_count?: number;
}

/** Landing-page card — no student marks. */
export interface GradebookHubItem {
  key: string;
  exam_id: string;
  class_id: string;
  gradebook_id: string | null;
  status: GradebookStatus | "READY";
  exam_reference: string;
  exam_name: string;
  subject_name: string;
  class_name: string;
  grade_name: string;
  academic_year_id: string;
  academic_year_name: string;
  term_id: string | null;
  term_name: string | null;
  max_marks: number;
  exam_date: string | null;
  last_updated_at: string | null;
  revision: number | null;
  marks_entry_open: boolean;
  assigned_to_viewer: boolean;
}

export interface GradebookRevisionConflict {
  code: "REVISION_CONFLICT";
  message: string;
}
