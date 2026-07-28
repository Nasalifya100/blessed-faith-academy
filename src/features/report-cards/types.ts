/**
 * Phase 2D.2 — Report cards types.
 * Academic values come only from Phase 2D.1 snapshots.
 */

export type ReportCardStatus =
  | "DRAFT"
  | "REVIEWED"
  | "APPROVED"
  | "PUBLISHED"
  | "UNPUBLISHED"
  | "VOIDED";

export type ReportCardSettings = {
  title: string;
  show_school_logo: boolean;
  show_admission_number: boolean;
  show_class_position: boolean;
  show_subject_position: boolean;
  show_grade_points: boolean;
  show_promotion_recommendation: boolean;
  show_attendance: boolean;
  show_teacher_remark: boolean;
  show_headteacher_remark: boolean;
  show_grading_key: boolean;
  show_generated_timestamp: boolean;
  require_teacher_remark_for_review: boolean;
  require_headteacher_remark_for_approve: boolean;
  footer_text: string | null;
  ranking_disabled_message: string;
  template_version: string;
};

export type AttendanceSnapshot = {
  available: boolean;
  term_start: string | null;
  term_end: string | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  percentage: number | null;
  note: string | null;
};

export type ReportCardSubjectRow = {
  subject_id: string;
  subject_name: string;
  weighted_percentage: number | null;
  grade_code: string | null;
  grade_label: string | null;
  grade_point: number | null;
  is_pass: boolean | null;
  remark: string | null;
  subject_position: number | null;
  entry_statuses: string[];
};

export type ReportCardRenderPayload = {
  schema_version: "2d.2.1";
  source_fingerprint: string;
  engine_version: string;
  computation_batch_id: string;
  template_version: string;
  generated_at: string;
  school: {
    name: string;
    motto: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logo_url: string | null;
  };
  academic_year: { id: string; name: string };
  term: { id: string; name: string };
  class: { id: string; name: string; grade_name: string };
  student: {
    id: string;
    first_name: string;
    last_name: string;
    middle_name: string | null;
    admission_number: string | null;
  };
  student_id: string;
  class_id: string;
  subjects: ReportCardSubjectRow[];
  summary: {
    average_percentage: number | null;
    grade_code: string | null;
    grade_label: string | null;
    grade_point: number | null;
    overall_position: number | null;
    tied_count: number;
    passed_subject_count: number;
    failed_subject_count: number;
    scored_subject_count: number;
    subject_count: number;
    promotion_outcome: string;
    promotion_reason: string | null;
    ranking_enabled: boolean;
  };
  attendance: AttendanceSnapshot;
  remarks: {
    teacher: string | null;
    headteacher: string | null;
  };
  settings: ReportCardSettings;
  grading_key: Array<{
    grade_code: string;
    grade_label: string;
    minimum_score: number;
    maximum_score: number;
    is_pass: boolean;
  }>;
  signatories: {
    class_teacher_name: string | null;
    headteacher_title: string;
  };
};

export const REPORT_CARD_TEMPLATE_VERSION = "2d.2.1";
