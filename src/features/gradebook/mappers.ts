import type { GradebookStatus, ResultEntryStatus } from "./schemas";
import type {
  ExamGradebookSummary,
  GradebookResultRow,
  GradebookRosterRow,
  OpenExamGradebookResponse,
  SaveGradebookDraftResponse,
  SubmitGradebookResponse,
} from "./types";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStatus(value: unknown): GradebookStatus | null {
  if (
    value === "DRAFT" ||
    value === "SUBMITTED" ||
    value === "REOPENED" ||
    value === "LOCKED"
  ) {
    return value;
  }
  return null;
}

function asEntryStatus(value: unknown): ResultEntryStatus | null {
  if (
    value === "SCORED" ||
    value === "ABSENT" ||
    value === "EXEMPT" ||
    value === "NOT_ASSESSED"
  ) {
    return value;
  }
  return null;
}

export function mapOpenExamGradebookResponse(
  raw: unknown,
): OpenExamGradebookResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const gb = data.gradebook as Record<string, unknown> | undefined;
  const exam = data.exam as Record<string, unknown> | undefined;
  if (!gb || !exam) return null;

  const status = asStatus(gb.status);
  const maxMarks = asNumber(exam.max_marks);
  const revision = asNumber(gb.revision);
  if (!status || maxMarks == null || maxMarks <= 0 || revision == null) {
    return null;
  }

  const rosterRaw = Array.isArray(data.roster) ? data.roster : [];
  const resultsRaw = Array.isArray(data.results) ? data.results : [];

  const roster: GradebookRosterRow[] = rosterRaw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const student_id = asString(r.student_id);
      if (!student_id) return null;
      return {
        student_id,
        admission_number: asString(r.admission_number),
        first_name: asString(r.first_name),
        last_name: asString(r.last_name),
        student_status: asString(r.student_status, "enrolled"),
      };
    })
    .filter(Boolean) as GradebookRosterRow[];

  const results: GradebookResultRow[] = resultsRaw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const student_id = asString(r.student_id);
      const entry_status = asEntryStatus(r.entry_status);
      const id = asString(r.id);
      const snap = asNumber(r.max_marks_snapshot) ?? maxMarks;
      const row_revision = asNumber(r.row_revision) ?? 1;
      if (!student_id || !entry_status || !id) return null;
      return {
        id,
        student_id,
        entry_status,
        marks_obtained: asNumber(r.marks_obtained),
        max_marks_snapshot: snap,
        comment: typeof r.comment === "string" ? r.comment : null,
        row_revision,
      };
    })
    .filter(Boolean) as GradebookResultRow[];

  const gradebook: ExamGradebookSummary = {
    id: asString(gb.id),
    exam_id: asString(gb.exam_id),
    class_id: asString(gb.class_id),
    status,
    revision,
    opened_by: typeof gb.opened_by === "string" ? gb.opened_by : null,
    opened_at: asString(gb.opened_at),
    last_saved_at:
      typeof gb.last_saved_at === "string" ? gb.last_saved_at : null,
    submitted_at:
      typeof gb.submitted_at === "string" ? gb.submitted_at : null,
    submitted_by:
      typeof gb.submitted_by === "string" ? gb.submitted_by : null,
    reopened_at:
      typeof gb.reopened_at === "string" ? gb.reopened_at : null,
    reopening_reason:
      typeof gb.reopening_reason === "string" ? gb.reopening_reason : null,
    locked_at: typeof gb.locked_at === "string" ? gb.locked_at : null,
    locked_by: typeof gb.locked_by === "string" ? gb.locked_by : null,
    created: Boolean(gb.created),
  };

  if (!gradebook.id || !gradebook.exam_id || !gradebook.class_id) return null;

  return {
    gradebook,
    exam: {
      id: asString(exam.id),
      exam_reference: asString(exam.exam_reference),
      status: asString(exam.status),
      subject_id: asString(exam.subject_id),
      grade_level_id: asString(exam.grade_level_id),
      max_marks: maxMarks,
      assessment_type_id: asString(exam.assessment_type_id),
      academic_year_id: asString(exam.academic_year_id),
      term_id: typeof exam.term_id === "string" ? exam.term_id : null,
    },
    roster,
    results,
    can_edit: Boolean(data.can_edit),
  };
}

export function mapSaveDraftResponse(
  raw: unknown,
): SaveGradebookDraftResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const status = asStatus(data.status);
  const revision = asNumber(data.revision);
  const saved = asNumber(data.saved_count);
  const id = asString(data.gradebook_id);
  if (!status || revision == null || saved == null || !id) return null;
  return {
    gradebook_id: id,
    revision,
    saved_count: saved,
    status,
  };
}

export function mapSubmitResponse(
  raw: unknown,
): SubmitGradebookResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const status = asStatus(data.status);
  const revision = asNumber(data.revision);
  const id = asString(data.gradebook_id);
  const submitted_at = asString(data.submitted_at);
  const roster_count = asNumber(data.roster_count);
  if (!status || revision == null || !id || !submitted_at || roster_count == null) {
    return null;
  }
  return {
    gradebook_id: id,
    status,
    revision,
    submitted_at,
    roster_count,
    pruned_ineligible_count: asNumber(data.pruned_ineligible_count) ?? undefined,
  };
}

export function mapRevisionStatusResponse(
  raw: unknown,
): { gradebook_id: string; revision: number; status: GradebookStatus } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const status = asStatus(data.status);
  const revision = asNumber(data.revision);
  const id = asString(data.gradebook_id);
  if (!status || revision == null || !id) return null;
  return { gradebook_id: id, revision, status };
}

/** Fail closed: only known editable statuses allow editing. */
export function isEditableGradebookStatus(
  status: string | null | undefined,
): boolean {
  return status === "DRAFT" || status === "REOPENED";
}
