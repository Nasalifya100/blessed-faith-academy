/**
 * Phase 2D.1 — subject/term aggregation + recalculation orchestration (pure).
 */

import { computeExamResult } from "@/features/results/engine/exam-result";
import { lookupGradeBand } from "@/features/results/engine/grade-lookup";
import { evaluatePromotion } from "@/features/results/engine/promotion";
import { rankScores } from "@/features/results/engine/ranking";
import { summarizeStatistics } from "@/features/results/engine/statistics";
import {
  buildWeightedComponents,
  computeWeightedPercentage,
  equalWeightAverage,
  type WeightItem,
} from "@/features/results/engine/weighting";
import type {
  ExamResultComputed,
  GradingSchemeInput,
  PromotionRule,
  RawMarkInput,
  ResultsEngineSettings,
  SubjectResultComputed,
  TermResultComputed,
} from "@/features/results/types";

const DEFAULT_SETTINGS: ResultsEngineSettings = {
  ranking_enabled: true,
  ranking_tie_mode: "COMPETITION",
  treat_absent_as_zero: false,
  include_exempt_in_average: false,
  include_not_assessed_in_average: false,
};

export type SubjectAggregateInput = {
  student_id: string;
  subject_id: string;
  /** assessment_type_id → raw exam mark (one primary exam per type for Stage 1) */
  assessments: Array<{
    assessment_type_id: string;
    raw: RawMarkInput;
  }>;
};

export function aggregateSubjectResult(args: {
  student_id: string;
  subject_id: string;
  assessments: Array<{
    assessment_type_id: string;
    raw: RawMarkInput;
  }>;
  scheme: GradingSchemeInput;
  weights?: WeightItem[] | null;
  settings?: ResultsEngineSettings;
}): SubjectResultComputed {
  const settings = args.settings ?? DEFAULT_SETTINGS;
  const byType: Record<
    string,
    { percentage: number | null; countable: boolean }
  > = {};

  const seenTypes = new Set<string>();
  for (const item of args.assessments) {
    if (seenTypes.has(item.assessment_type_id)) {
      throw new Error(
        `Duplicate assessment_type_id ${item.assessment_type_id} for subject aggregation.`,
      );
    }
    seenTypes.add(item.assessment_type_id);
    const computed = computeExamResult(item.raw, args.scheme, settings);
    byType[item.assessment_type_id] = {
      percentage: computed.percentage,
      countable: computed.percentage != null,
    };
  }

  let weighted: number | null;
  let components: SubjectResultComputed["components"];

  if (args.weights && args.weights.length > 0) {
    components = buildWeightedComponents(args.weights, byType);
    weighted = computeWeightedPercentage(components, {
      decimalPlaces: args.scheme.decimal_places,
    });
  } else {
    const percentages = Object.values(byType).map((v) => v.percentage);
    weighted = equalWeightAverage(percentages, {
      decimalPlaces: args.scheme.decimal_places,
    });
    components = Object.entries(byType).map(([assessment_type_id, v]) => ({
      assessment_type_id,
      weight_percentage: 0,
      percentage: v.percentage,
      countable: v.countable,
    }));
  }

  const band =
    weighted == null ? null : lookupGradeBand(weighted, args.scheme);

  return {
    student_id: args.student_id,
    subject_id: args.subject_id,
    components,
    weighted_percentage: weighted,
    grade_code: band?.grade_code ?? null,
    grade_label: band?.grade_label ?? null,
    grade_point: band?.grade_point ?? null,
    is_pass: band?.is_pass ?? null,
    remark: band?.remark ?? null,
    subject_position: null,
    tied_count: 0,
  };
}

export function applySubjectPositions(
  results: SubjectResultComputed[],
  settings: ResultsEngineSettings = DEFAULT_SETTINGS,
): SubjectResultComputed[] {
  if (!settings.ranking_enabled) {
    return results.map((r) => ({
      ...r,
      subject_position: null,
      tied_count: 0,
    }));
  }
  const ranks = rankScores(
    results.map((r) => ({
      id: r.student_id,
      score: r.weighted_percentage,
    })),
    settings.ranking_tie_mode,
  );
  const byId = new Map(ranks.map((r) => [r.id, r]));
  return results.map((r) => {
    const hit = byId.get(r.student_id);
    return {
      ...r,
      subject_position: hit?.position ?? null,
      tied_count: hit?.tied_count ?? 0,
    };
  });
}

export function aggregateTermResult(args: {
  student_id: string;
  subjects: SubjectResultComputed[];
  scheme: GradingSchemeInput;
  promotionRules?: PromotionRule[];
  settings?: ResultsEngineSettings;
  isTerminalGrade?: boolean;
}): TermResultComputed {
  const subjects = args.subjects.filter((s) => s.student_id === args.student_id);
  const scored = subjects.filter((s) => s.weighted_percentage != null);
  const passed = scored.filter((s) => s.is_pass === true);
  const failed = scored.filter((s) => s.is_pass === false);

  const average = equalWeightAverage(
    scored.map((s) => s.weighted_percentage),
    { decimalPlaces: args.scheme.decimal_places },
  );
  const band =
    average == null ? null : lookupGradeBand(average, args.scheme);

  const promotion = evaluatePromotion(
    {
      average_percentage: average,
      passed_subject_count: passed.length,
      failed_subject_count: failed.length,
      scored_subject_count: scored.length,
      subject_count: subjects.length,
      is_terminal_grade: args.isTerminalGrade,
    },
    args.promotionRules ?? [],
  );

  return {
    student_id: args.student_id,
    subject_count: subjects.length,
    scored_subject_count: scored.length,
    passed_subject_count: passed.length,
    failed_subject_count: failed.length,
    average_percentage: average,
    grade_code: band?.grade_code ?? null,
    grade_label: band?.grade_label ?? null,
    grade_point: band?.grade_point ?? null,
    is_pass: band?.is_pass ?? null,
    remark: band?.remark ?? null,
    overall_position: null,
    tied_count: 0,
    promotion_outcome: promotion.outcome,
    promotion_reason: promotion.reason,
  };
}

export function applyOverallPositions(
  results: TermResultComputed[],
  settings: ResultsEngineSettings = DEFAULT_SETTINGS,
): TermResultComputed[] {
  if (!settings.ranking_enabled) {
    return results.map((r) => ({
      ...r,
      overall_position: null,
      tied_count: 0,
    }));
  }
  const ranks = rankScores(
    results.map((r) => ({
      id: r.student_id,
      score: r.average_percentage,
    })),
    settings.ranking_tie_mode,
  );
  const byId = new Map(ranks.map((r) => [r.id, r]));
  return results.map((r) => {
    const hit = byId.get(r.student_id);
    return {
      ...r,
      overall_position: hit?.position ?? null,
      tied_count: hit?.tied_count ?? 0,
    };
  });
}

export type RecalculateClassTermInput = {
  scheme: GradingSchemeInput;
  settings?: ResultsEngineSettings;
  promotionRules?: PromotionRule[];
  isTerminalGrade?: boolean;
  /** Flat list of exam marks already filtered to SUBMITTED/LOCKED gradebooks */
  examMarks: Array<{
    student_id: string;
    subject_id: string;
    assessment_type_id: string;
    raw: RawMarkInput;
  }>;
  weightsBySubject?: Record<string, WeightItem[] | null | undefined>;
};

export type RecalculateClassTermOutput = {
  exam_results: ExamResultComputed[];
  subject_results: SubjectResultComputed[];
  term_results: TermResultComputed[];
  class_statistics: ReturnType<typeof summarizeStatistics>;
  subject_statistics: Record<
    string,
    ReturnType<typeof summarizeStatistics>
  >;
};

/**
 * Full class×term recalculation pipeline (pure, deterministic).
 * Callers persist snapshots via RPC / server actions.
 */
export function recalculateClassTerm(
  input: RecalculateClassTermInput,
): RecalculateClassTermOutput {
  const settings = input.settings ?? DEFAULT_SETTINGS;

  const exam_results = input.examMarks.map((m) =>
    computeExamResult(m.raw, input.scheme, settings),
  );

  const subjectKeys = new Map<
    string,
    {
      student_id: string;
      subject_id: string;
      assessments: Array<{ assessment_type_id: string; raw: RawMarkInput }>;
    }
  >();

  for (const mark of input.examMarks) {
    const key = `${mark.student_id}::${mark.subject_id}`;
    const existing = subjectKeys.get(key);
    if (existing) {
      existing.assessments.push({
        assessment_type_id: mark.assessment_type_id,
        raw: mark.raw,
      });
    } else {
      subjectKeys.set(key, {
        student_id: mark.student_id,
        subject_id: mark.subject_id,
        assessments: [
          {
            assessment_type_id: mark.assessment_type_id,
            raw: mark.raw,
          },
        ],
      });
    }
  }

  let subject_results: SubjectResultComputed[] = [];
  const bySubject = new Map<string, SubjectResultComputed[]>();

  for (const group of subjectKeys.values()) {
    const result = aggregateSubjectResult({
      student_id: group.student_id,
      subject_id: group.subject_id,
      assessments: group.assessments,
      scheme: input.scheme,
      weights: input.weightsBySubject?.[group.subject_id] ?? null,
      settings,
    });
    const list = bySubject.get(group.subject_id) ?? [];
    list.push(result);
    bySubject.set(group.subject_id, list);
  }

  for (const [subjectId, list] of bySubject) {
    const ranked = applySubjectPositions(list, settings);
    bySubject.set(subjectId, ranked);
    subject_results = subject_results.concat(ranked);
  }

  const studentIds = [...new Set(input.examMarks.map((m) => m.student_id))];
  let term_results = studentIds.map((student_id) =>
    aggregateTermResult({
      student_id,
      subjects: subject_results.filter((s) => s.student_id === student_id),
      scheme: input.scheme,
      promotionRules: input.promotionRules,
      settings,
      isTerminalGrade: input.isTerminalGrade,
    }),
  );
  term_results = applyOverallPositions(term_results, settings);

  const class_statistics = summarizeStatistics(
    term_results.map((t) => ({
      value: t.average_percentage,
      is_pass: t.is_pass,
      grade_code: t.grade_code,
      grade_label: t.grade_label,
    })),
    { decimalPlaces: input.scheme.decimal_places },
  );

  const subject_statistics: RecalculateClassTermOutput["subject_statistics"] =
    {};
  for (const [subjectId, list] of bySubject) {
    subject_statistics[subjectId] = summarizeStatistics(
      list.map((s) => ({
        value: s.weighted_percentage,
        is_pass: s.is_pass,
        grade_code: s.grade_code,
        grade_label: s.grade_label,
      })),
      { decimalPlaces: input.scheme.decimal_places },
    );
  }

  return {
    exam_results,
    subject_results,
    term_results,
    class_statistics,
    subject_statistics,
  };
}
