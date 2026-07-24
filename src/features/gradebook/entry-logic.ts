import type { ResultEntryStatus } from "./schemas";
import { marksWithinMaximum } from "./schemas";

export type EditableResultRow = {
  student_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  entry_status: ResultEntryStatus | null;
  marks_obtained: number | null;
  /** Raw mark field text while typing (may be temporarily invalid). */
  marks_text: string;
};

export type RowValidation =
  | { ok: true; kind: "blank" | "valid" }
  | { ok: false; message: string };

export type GradebookSummaryStats = {
  total: number;
  completed: number;
  missing: number;
  invalid: number;
  scored: number;
  absent: number;
  exempt: number;
  not_assessed: number;
  highest: number | null;
  lowest: number | null;
  average: number | null;
};

export function displayName(row: {
  first_name: string;
  last_name: string;
}): string {
  return `${row.last_name}, ${row.first_name}`.trim();
}

export function emptyEditableRow(student: {
  student_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
}): EditableResultRow {
  return {
    student_id: student.student_id,
    admission_number: student.admission_number,
    first_name: student.first_name,
    last_name: student.last_name,
    entry_status: null,
    marks_obtained: null,
    marks_text: "",
  };
}

export function rowFromServerResult(
  student: {
    student_id: string;
    admission_number: string;
    first_name: string;
    last_name: string;
  },
  result:
    | {
        entry_status: ResultEntryStatus;
        marks_obtained: number | null;
      }
    | undefined,
): EditableResultRow {
  if (!result) return emptyEditableRow(student);
  return {
    ...emptyEditableRow(student),
    entry_status: result.entry_status,
    marks_obtained: result.marks_obtained,
    marks_text:
      result.marks_obtained == null ? "" : String(result.marks_obtained),
  };
}

/** Typing a valid finite mark selects SCORED. */
export function applyMarkText(
  row: EditableResultRow,
  text: string,
): EditableResultRow {
  const trimmed = text.trim();
  if (trimmed === "") {
    return {
      ...row,
      marks_text: text,
      marks_obtained: null,
      entry_status:
        row.entry_status === "SCORED" ? null : row.entry_status,
    };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return {
      ...row,
      marks_text: text,
      marks_obtained: null,
      entry_status: "SCORED",
    };
  }

  return {
    ...row,
    marks_text: text,
    marks_obtained: parsed,
    entry_status: "SCORED",
  };
}

/** Non-scored status clears the mark. */
export function applyEntryStatus(
  row: EditableResultRow,
  status: ResultEntryStatus,
): EditableResultRow {
  if (status === "SCORED") {
    return { ...row, entry_status: "SCORED" };
  }
  return {
    ...row,
    entry_status: status,
    marks_obtained: null,
    marks_text: "",
  };
}

export function validateEditableRow(
  row: EditableResultRow,
  maxMarks: number,
): RowValidation {
  if (row.entry_status == null) {
    if (row.marks_text.trim() !== "") {
      return { ok: false, message: "Enter a valid mark or choose a status." };
    }
    return { ok: true, kind: "blank" };
  }

  if (row.entry_status === "SCORED") {
    const text = row.marks_text.trim();
    if (text === "") {
      return { ok: false, message: "Scored entries require a mark." };
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return { ok: false, message: "Marks must be a finite number." };
    }
    if (parsed < 0) {
      return { ok: false, message: "Marks cannot be negative." };
    }
    if (!marksWithinMaximum(parsed, maxMarks)) {
      return {
        ok: false,
        message: `Marks cannot exceed the exam maximum (${maxMarks}).`,
      };
    }
    return { ok: true, kind: "valid" };
  }

  if (row.marks_text.trim() !== "" || row.marks_obtained != null) {
    return {
      ok: false,
      message: "Non-scored statuses cannot include a mark.",
    };
  }
  return { ok: true, kind: "valid" };
}

export function computeSummary(
  rows: EditableResultRow[],
  maxMarks: number,
): GradebookSummaryStats {
  let completed = 0;
  let missing = 0;
  let invalid = 0;
  let scored = 0;
  let absent = 0;
  let exempt = 0;
  let not_assessed = 0;
  const scoredMarks: number[] = [];

  for (const row of rows) {
    const v = validateEditableRow(row, maxMarks);
    if (!v.ok) {
      invalid += 1;
      continue;
    }
    if (v.kind === "blank") {
      missing += 1;
      continue;
    }
    completed += 1;
    switch (row.entry_status) {
      case "SCORED":
        scored += 1;
        if (row.marks_obtained != null && Number.isFinite(row.marks_obtained)) {
          scoredMarks.push(row.marks_obtained);
        }
        break;
      case "ABSENT":
        absent += 1;
        break;
      case "EXEMPT":
        exempt += 1;
        break;
      case "NOT_ASSESSED":
        not_assessed += 1;
        break;
      default:
        break;
    }
  }

  const highest =
    scoredMarks.length > 0 ? Math.max(...scoredMarks) : null;
  const lowest =
    scoredMarks.length > 0 ? Math.min(...scoredMarks) : null;
  const average =
    scoredMarks.length > 0
      ? scoredMarks.reduce((a, b) => a + b, 0) / scoredMarks.length
      : null;

  return {
    total: rows.length,
    completed,
    missing,
    invalid,
    scored,
    absent,
    exempt,
    not_assessed,
    highest,
    lowest,
    average,
  };
}

export function canProceedToReview(
  rows: EditableResultRow[],
  maxMarks: number,
  options: { dirty: boolean; revisionConflict: boolean },
): { ok: true } | { ok: false; reason: string } {
  if (options.revisionConflict) {
    return {
      ok: false,
      reason: "Resolve the revision conflict before reviewing.",
    };
  }
  if (options.dirty) {
    return {
      ok: false,
      reason: "Save your draft before reviewing for submission.",
    };
  }
  const summary = computeSummary(rows, maxMarks);
  if (summary.invalid > 0) {
    return { ok: false, reason: "Fix invalid rows before reviewing." };
  }
  if (summary.missing > 0) {
    return {
      ok: false,
      reason: "Every eligible student needs a result before reviewing.",
    };
  }
  if (summary.total === 0) {
    return { ok: false, reason: "There are no eligible students." };
  }
  return { ok: true };
}

/** Payload rows for save_exam_gradebook_draft (partial upsert of completed rows). */
export function buildDraftPayloadRows(
  rows: EditableResultRow[],
  maxMarks: number,
):
  | {
      ok: true;
      rows: Array<{
        student_id: string;
        entry_status: ResultEntryStatus;
        marks_obtained: number | null;
      }>;
    }
  | { ok: false; message: string; firstInvalidStudentId?: string } {
  const out: Array<{
    student_id: string;
    entry_status: ResultEntryStatus;
    marks_obtained: number | null;
  }> = [];

  for (const row of rows) {
    const v = validateEditableRow(row, maxMarks);
    if (!v.ok) {
      return {
        ok: false,
        message: v.message,
        firstInvalidStudentId: row.student_id,
      };
    }
    if (v.kind === "blank") continue;
    if (!row.entry_status) continue;
    out.push({
      student_id: row.student_id,
      entry_status: row.entry_status,
      marks_obtained:
        row.entry_status === "SCORED" ? Number(row.marks_text.trim()) : null,
    });
  }

  if (out.length === 0) {
    return {
      ok: false,
      message: "Add at least one mark or status before saving.",
    };
  }
  return { ok: true, rows: out };
}

export function rowsEqual(
  a: EditableResultRow[],
  b: EditableResultRow[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.student_id !== right.student_id ||
      left.entry_status !== right.entry_status ||
      left.marks_text !== right.marks_text ||
      left.marks_obtained !== right.marks_obtained
    ) {
      return false;
    }
  }
  return true;
}

export const SUBMIT_CONFIRMATION_TEXT =
  "Submit this gradebook? Marks will become read-only. An authorised academic administrator must reopen it before further changes.";

export const LOCK_CONFIRMATION_TEXT =
  "Lock this gradebook? Locked gradebooks cannot be reopened or edited in Stage 1. This action is final for normal workflows.";
