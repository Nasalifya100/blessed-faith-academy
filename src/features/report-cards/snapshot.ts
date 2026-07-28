import { createHash } from "node:crypto";

import type {
  AttendanceSnapshot,
  ReportCardRenderPayload,
  ReportCardSettings,
  ReportCardSubjectRow,
} from "@/features/report-cards/types";
import { REPORT_CARD_TEMPLATE_VERSION } from "@/features/report-cards/types";

export function defaultReportCardSettings(): ReportCardSettings {
  return {
    title: "Term Report Card",
    show_school_logo: true,
    show_admission_number: true,
    show_class_position: true,
    show_subject_position: false,
    show_grade_points: true,
    show_promotion_recommendation: true,
    show_attendance: true,
    show_teacher_remark: true,
    show_headteacher_remark: true,
    show_grading_key: true,
    show_generated_timestamp: true,
    require_teacher_remark_for_review: false,
    require_headteacher_remark_for_approve: true,
    footer_text: null,
    ranking_disabled_message:
      "Class ranking is not published for this term.",
    template_version: REPORT_CARD_TEMPLATE_VERSION,
  };
}

export function checksumRenderPayload(payload: ReportCardRenderPayload): string {
  const material = JSON.stringify(payload);
  return createHash("sha256").update(material).digest("hex");
}

export function sanitizePlainRemark(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, 2000);
}

export function emptyAttendanceSnapshot(
  termStart: string | null,
  termEnd: string | null,
  note: string,
): AttendanceSnapshot {
  return {
    available: false,
    term_start: termStart,
    term_end: termEnd,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    total: 0,
    percentage: null,
    note,
  };
}

export function buildAttendanceSnapshot(args: {
  termStart: string | null;
  termEnd: string | null;
  statuses: string[];
}): AttendanceSnapshot {
  if (!args.termStart || !args.termEnd) {
    return emptyAttendanceSnapshot(null, null, "Term dates are not configured.");
  }
  const present = args.statuses.filter((s) => s === "present").length;
  const absent = args.statuses.filter((s) => s === "absent").length;
  const late = args.statuses.filter((s) => s === "late").length;
  const excused = args.statuses.filter((s) => s === "excused").length;
  const total = args.statuses.length;
  if (total === 0) {
    return emptyAttendanceSnapshot(
      args.termStart,
      args.termEnd,
      "No attendance registers recorded for this term.",
    );
  }
  const percentage = Math.round(((present + late) / total) * 10000) / 100;
  return {
    available: true,
    term_start: args.termStart,
    term_end: args.termEnd,
    present,
    absent,
    late,
    excused,
    total,
    percentage,
    note: null,
  };
}

export function mapSubjectRows(
  rows: Array<{
    subject_id: string;
    subject_name: string;
    weighted_percentage: number | null;
    grade_code: string | null;
    grade_label: string | null;
    grade_point: number | null;
    is_pass: boolean | null;
    remark: string | null;
    subject_position: number | null;
  }>,
  examStatusesBySubject: Record<string, string[]>,
): ReportCardSubjectRow[] {
  return rows.map((row) => ({
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    weighted_percentage: row.weighted_percentage,
    grade_code: row.grade_code,
    grade_label: row.grade_label,
    grade_point: row.grade_point,
    is_pass: row.is_pass,
    remark: row.remark,
    subject_position: row.subject_position,
    entry_statuses: examStatusesBySubject[row.subject_id] ?? [],
  }));
}
