import { describe, expect, it } from "vitest";

import {
  applyEntryStatus,
  applyMarkText,
  buildDraftPayloadRows,
  canProceedToReview,
  computeSummary,
  rowFromServerResult,
  SUBMIT_CONFIRMATION_TEXT,
  validateEditableRow,
} from "@/features/gradebook/entry-logic";
import { normalizeGradebookError } from "@/features/gradebook/errors";
import {
  buildRecoveryPayload,
  clearLocalRecovery,
  readLocalRecovery,
  writeLocalRecovery,
  type RecoveryStorage,
} from "@/features/gradebook/local-recovery";
import {
  isEditableGradebookStatus,
  mapOpenExamGradebookResponse,
  mapRevisionStatusResponse,
} from "@/features/gradebook/mappers";
import {
  canLockGradebook,
  canOpenGradebook,
  canReopenGradebook,
  hasGradebookCapability,
} from "@/features/gradebook/permissions";
import { lockGradebookSchema, reopenGradebookSchema } from "@/features/gradebook/schemas";

const STUDENT = {
  student_id: "11111111-1111-4111-8111-111111111111",
  admission_number: "A001",
  first_name: "Ada",
  last_name: "Lovelace",
};

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
  };
}

describe("gradebook nav visibility", () => {
  it("shows gradebook for teacher and elevated roles", () => {
    expect(canOpenGradebook("teacher")).toBe(true);
    expect(canOpenGradebook("headteacher")).toBe(true);
    expect(canOpenGradebook("administrator")).toBe(true);
  });

  it("hides gradebook from secretary and bursar by default", () => {
    expect(canOpenGradebook("secretary")).toBe(false);
    expect(canOpenGradebook("bursar")).toBe(false);
    expect(hasGradebookCapability("secretary", "GRADEBOOK_VIEW_ALL")).toBe(
      false,
    );
  });
});

describe("entry logic", () => {
  it("selects SCORED when a numeric mark is typed", () => {
    const row = rowFromServerResult(STUDENT, undefined);
    const next = applyMarkText(row, "42");
    expect(next.entry_status).toBe("SCORED");
    expect(next.marks_obtained).toBe(42);
  });

  it("clears mark when choosing a non-scored status", () => {
    const scored = applyMarkText(rowFromServerResult(STUDENT, undefined), "10");
    const absent = applyEntryStatus(scored, "ABSENT");
    expect(absent.entry_status).toBe("ABSENT");
    expect(absent.marks_obtained).toBeNull();
    expect(absent.marks_text).toBe("");
  });

  it("rejects negative and above-maximum marks", () => {
    const neg = applyMarkText(rowFromServerResult(STUDENT, undefined), "-1");
    expect(validateEditableRow(neg, 50).ok).toBe(false);
    const high = applyMarkText(rowFromServerResult(STUDENT, undefined), "50.01");
    expect(validateEditableRow(high, 50).ok).toBe(false);
  });

  it("accepts decimal marks within maximum", () => {
    const row = applyMarkText(rowFromServerResult(STUDENT, undefined), "12.5");
    expect(validateEditableRow(row, 50)).toEqual({ ok: true, kind: "valid" });
  });

  it("excludes non-scored rows from average/high/low", () => {
    const a = applyMarkText(rowFromServerResult(STUDENT, undefined), "10");
    const b = applyEntryStatus(
      rowFromServerResult(
        { ...STUDENT, student_id: "22222222-2222-4222-8222-222222222222" },
        undefined,
      ),
      "ABSENT",
    );
    const summary = computeSummary([a, b], 50);
    expect(summary.scored).toBe(1);
    expect(summary.absent).toBe(1);
    expect(summary.average).toBe(10);
    expect(summary.highest).toBe(10);
    expect(summary.lowest).toBe(10);
  });

  it("blocks review when rows are missing or invalid or dirty", () => {
    const blank = rowFromServerResult(STUDENT, undefined);
    expect(canProceedToReview([blank], 50, { dirty: false, revisionConflict: false }).ok).toBe(
      false,
    );
    const scored = applyMarkText(blank, "10");
    expect(
      canProceedToReview([scored], 50, { dirty: true, revisionConflict: false }).ok,
    ).toBe(false);
    expect(
      canProceedToReview([scored], 50, { dirty: false, revisionConflict: false }).ok,
    ).toBe(true);
  });

  it("builds draft payload only from completed valid rows", () => {
    const scored = applyMarkText(rowFromServerResult(STUDENT, undefined), "8");
    const blank = rowFromServerResult(
      { ...STUDENT, student_id: "22222222-2222-4222-8222-222222222222" },
      undefined,
    );
    const payload = buildDraftPayloadRows([scored, blank], 50);
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.rows).toHaveLength(1);
      expect(payload.rows[0].marks_obtained).toBe(8);
    }
  });
  it("treats zero as a valid scored mark in summaries", () => {
    const zero = applyMarkText(rowFromServerResult(STUDENT, undefined), "0");
    const summary = computeSummary([zero], 50);
    expect(summary.scored).toBe(1);
    expect(summary.average).toBe(0);
    expect(summary.highest).toBe(0);
    expect(summary.lowest).toBe(0);
  });

  it("handles an all non-scored roster without NaN averages", () => {
    const absent = applyEntryStatus(
      rowFromServerResult(STUDENT, undefined),
      "ABSENT",
    );
    const summary = computeSummary([absent], 50);
    expect(summary.average).toBeNull();
    expect(summary.highest).toBeNull();
    expect(Number.isNaN(summary.average as number)).toBe(false);
  });
});

describe("status fail-closed", () => {
  it("only DRAFT and REOPENED are editable statuses", () => {
    expect(isEditableGradebookStatus("DRAFT")).toBe(true);
    expect(isEditableGradebookStatus("REOPENED")).toBe(true);
    expect(isEditableGradebookStatus("SUBMITTED")).toBe(false);
    expect(isEditableGradebookStatus("LOCKED")).toBe(false);
    expect(isEditableGradebookStatus("UNKNOWN")).toBe(false);
    expect(isEditableGradebookStatus(null)).toBe(false);
  });
});

describe("reopen and lock contracts", () => {
  it("requires expected_revision for reopen and lock schemas", () => {
    expect(
      reopenGradebookSchema.safeParse({
        gradebook_id: STUDENT.student_id,
        reason: "Fix marks",
      }).success,
    ).toBe(false);
    expect(
      lockGradebookSchema.safeParse({
        gradebook_id: STUDENT.student_id,
      }).success,
    ).toBe(false);
    expect(
      lockGradebookSchema.safeParse({
        gradebook_id: STUDENT.student_id,
        expected_revision: 4,
      }).success,
    ).toBe(true);
  });

  it("maps reopen/lock RPC responses", () => {
    const mapped = mapRevisionStatusResponse({
      gradebook_id: STUDENT.student_id,
      revision: 5,
      status: "REOPENED",
    });
    expect(mapped).toEqual({
      gradebook_id: STUDENT.student_id,
      revision: 5,
      status: "REOPENED",
    });
  });
});

describe("RPC response mapping", () => {
  it("maps a valid Stage 1 open response", () => {
    const mapped = mapOpenExamGradebookResponse({
      gradebook: {
        id: "33333333-3333-4333-8333-333333333333",
        exam_id: "44444444-4444-4444-8444-444444444444",
        class_id: "55555555-5555-4555-8555-555555555555",
        status: "DRAFT",
        revision: 2,
        opened_by: null,
        opened_at: "2026-07-24T10:00:00Z",
        last_saved_at: null,
        submitted_at: null,
        submitted_by: null,
        reopened_at: null,
        reopening_reason: null,
        locked_at: null,
        created: true,
      },
      exam: {
        id: "44444444-4444-4444-8444-444444444444",
        exam_reference: "EX-2026-T1-0001",
        status: "COMPLETED",
        subject_id: "66666666-6666-4666-8666-666666666666",
        grade_level_id: "77777777-7777-4777-8777-777777777777",
        max_marks: 50,
        assessment_type_id: "88888888-8888-4888-8888-888888888888",
        academic_year_id: "99999999-9999-4999-8999-999999999999",
        term_id: null,
      },
      roster: [STUDENT],
      results: [],
      can_edit: true,
    });
    expect(mapped?.gradebook.revision).toBe(2);
    expect(mapped?.exam.max_marks).toBe(50);
    expect(mapped?.roster).toHaveLength(1);
  });
});

describe("local recovery", () => {
  it("writes and clears recovery keyed by user, gradebook, and revision", () => {
    const storage = memoryStorage();
    const payload = buildRecoveryPayload("user-1", "gb1", 3, [
      { student_id: STUDENT.student_id, entry_status: "SCORED", marks_text: "9" },
    ]);
    expect(writeLocalRecovery(storage, payload)).toBe(true);
    expect(readLocalRecovery(storage, "user-1", "gb1", 3)?.rows).toHaveLength(1);
    expect(readLocalRecovery(storage, "user-2", "gb1", 3)).toBeNull();
    clearLocalRecovery(storage, "user-1", "gb1", 3);
    expect(readLocalRecovery(storage, "user-1", "gb1", 3)).toBeNull();
  });

  it("does not treat a different revision as an exact match", () => {
    const storage = memoryStorage();
    writeLocalRecovery(
      storage,
      buildRecoveryPayload("user-1", "gb1", 2, [
        { student_id: STUDENT.student_id, entry_status: "ABSENT", marks_text: "" },
      ]),
    );
    expect(readLocalRecovery(storage, "user-1", "gb1", 3)).toBeNull();
  });

  it("isolates recovery by user on a shared browser", () => {
    const storage = memoryStorage();
    writeLocalRecovery(
      storage,
      buildRecoveryPayload("user-a", "gb1", 1, [
        { student_id: STUDENT.student_id, entry_status: "SCORED", marks_text: "5" },
      ]),
    );
    expect(readLocalRecovery(storage, "user-b", "gb1", 1)).toBeNull();
  });

  it("handles storage write failure without throwing", () => {
    const broken: RecoveryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(
      writeLocalRecovery(
        broken,
        buildRecoveryPayload("u", "g", 1, [
          { student_id: STUDENT.student_id, entry_status: null, marks_text: "" },
        ]),
      ),
    ).toBe(false);
  });
});

describe("error normalization", () => {
  it("maps revision conflicts without exposing SQL", () => {
    const err = normalizeGradebookError(
      "Gradebook was updated by someone else. Reload and try again. (revision conflict)",
    );
    expect(err.code).toBe("REVISION_CONFLICT");
    expect(err.message).not.toMatch(/SQL|constraint/i);
  });

  it("hides SQL-ish messages", () => {
    const err = normalizeGradebookError(
      'new row for relation "exam_assessment_results" violates check constraint',
    );
    expect(err.code).toBe("GENERIC");
    expect(err.message).not.toMatch(/relation|constraint/i);
  });
});

describe("submit and lock UX copy", () => {
  it("uses explicit submit confirmation wording", () => {
    expect(SUBMIT_CONFIRMATION_TEXT).toMatch(/read-only/i);
    expect(SUBMIT_CONFIRMATION_TEXT).toMatch(/reopen/i);
  });

  it("requires reopen capability and rejects secretary", () => {
    expect(canReopenGradebook("headteacher")).toBe(true);
    expect(canReopenGradebook("teacher")).toBe(false);
    expect(canLockGradebook("administrator")).toBe(true);
    expect(canLockGradebook("secretary")).toBe(false);
  });
});
