/**
 * Phase 2D.1 — compute a single exam-level result from raw marks + scheme.
 */

import { lookupGradeBand } from "@/features/results/engine/grade-lookup";
import { marksToPercentage } from "@/features/results/engine/rounding";
import type {
  ExamResultComputed,
  GradingSchemeInput,
  RawMarkInput,
  ResultsEngineSettings,
  ResultEntryStatus,
} from "@/features/results/types";

const DEFAULT_SETTINGS: ResultsEngineSettings = {
  ranking_enabled: true,
  ranking_tie_mode: "COMPETITION",
  treat_absent_as_zero: false,
  include_exempt_in_average: false,
  include_not_assessed_in_average: false,
};

export function resolvePercentageForStatus(
  input: RawMarkInput,
  scheme: GradingSchemeInput,
  settings: ResultsEngineSettings = DEFAULT_SETTINGS,
): { percentage: number | null; countable: boolean } {
  const status: ResultEntryStatus = input.entry_status;

  if (status === "SCORED") {
    const percentage = marksToPercentage(input.marks_obtained, input.max_marks, {
      decimalPlaces: scheme.decimal_places,
      roundingMode: scheme.rounding_mode,
      schemeMin: scheme.min_score,
      schemeMax: scheme.max_score,
    });
    return { percentage, countable: percentage != null };
  }

  if (status === "ABSENT") {
    if (settings.treat_absent_as_zero) {
      return { percentage: scheme.min_score, countable: true };
    }
    return { percentage: null, countable: false };
  }

  // EXEMPT / NOT_ASSESSED never invent a numeric mark.
  // include_* flags are reserved; averages always omit null percentages.
  void settings.include_exempt_in_average;
  void settings.include_not_assessed_in_average;
  if (status === "EXEMPT" || status === "NOT_ASSESSED") {
    return { percentage: null, countable: false };
  }

  return { percentage: null, countable: false };
}

export function computeExamResult(
  input: RawMarkInput,
  scheme: GradingSchemeInput,
  settings: ResultsEngineSettings = DEFAULT_SETTINGS,
): ExamResultComputed {
  const { percentage } = resolvePercentageForStatus(input, scheme, settings);

  if (percentage == null) {
    return {
      student_id: input.student_id,
      entry_status: input.entry_status,
      marks_obtained: input.marks_obtained,
      max_marks: input.max_marks,
      percentage: null,
      grade_code: null,
      grade_label: null,
      grade_point: null,
      is_pass: null,
      remark: null,
      grading_scheme_id: scheme.id,
      grading_scheme_version: scheme.version,
    };
  }

  const band = lookupGradeBand(percentage, scheme);
  return {
    student_id: input.student_id,
    entry_status: input.entry_status,
    marks_obtained: input.marks_obtained,
    max_marks: input.max_marks,
    percentage,
    grade_code: band?.grade_code ?? null,
    grade_label: band?.grade_label ?? null,
    grade_point: band?.grade_point ?? null,
    is_pass: band?.is_pass ?? null,
    remark: band?.remark ?? null,
    grading_scheme_id: scheme.id,
    grading_scheme_version: scheme.version,
  };
}

export function computeExamResults(
  inputs: RawMarkInput[],
  scheme: GradingSchemeInput,
  settings?: ResultsEngineSettings,
): ExamResultComputed[] {
  return inputs.map((row) => computeExamResult(row, scheme, settings));
}
