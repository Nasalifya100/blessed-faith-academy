import { describe, expect, it } from "vitest";

import {
  aggregateSubjectResult,
  applyOverallPositions,
  applySubjectPositions,
  aggregateTermResult,
  recalculateClassTerm,
} from "@/features/results/engine/aggregation";
import { computeExamResult } from "@/features/results/engine/exam-result";
import {
  bandCoverageGaps,
  lookupGradeBand,
} from "@/features/results/engine/grade-lookup";
import { evaluatePromotion, defaultPromotionRules } from "@/features/results/engine/promotion";
import { rankScores } from "@/features/results/engine/ranking";
import {
  marksToPercentage,
  roundScore,
} from "@/features/results/engine/rounding";
import {
  computeMedian,
  computeMode,
  summarizeStatistics,
} from "@/features/results/engine/statistics";
import {
  computeWeightedPercentage,
  equalWeightAverage,
} from "@/features/results/engine/weighting";
import type { GradingSchemeInput } from "@/features/results/types";
import {
  canManagePromotionPolicies,
  canOpenResults,
  canRecalculateResults,
  canViewAllResults,
  hasResultsCapability,
} from "@/features/results/permissions";

const SCHEME: GradingSchemeInput = {
  id: "scheme-1",
  version: 1,
  min_score: 0,
  max_score: 100,
  decimal_places: 0,
  rounding_mode: "half_up",
  bands: [
    {
      minimum_score: 80,
      maximum_score: 100,
      grade_code: "A",
      grade_label: "Distinction",
      grade_point: 4,
      performance_description: "Excellent",
      is_pass: true,
      display_order: 1,
    },
    {
      minimum_score: 70,
      maximum_score: 79,
      grade_code: "B",
      grade_label: "Merit",
      grade_point: 3,
      performance_description: "Very Good",
      is_pass: true,
      display_order: 2,
    },
    {
      minimum_score: 60,
      maximum_score: 69,
      grade_code: "C",
      grade_label: "Credit",
      grade_point: 2,
      performance_description: "Good",
      is_pass: true,
      display_order: 3,
    },
    {
      minimum_score: 50,
      maximum_score: 59,
      grade_code: "D",
      grade_label: "Pass",
      grade_point: 1,
      performance_description: "Fair",
      is_pass: true,
      display_order: 4,
    },
    {
      minimum_score: 0,
      maximum_score: 49,
      grade_code: "F",
      grade_label: "Fail",
      grade_point: 0,
      performance_description: "Needs Improvement",
      is_pass: false,
      display_order: 5,
    },
  ],
};

describe("results engine rounding + percentage", () => {
  it("supports half_even rounding", () => {
    expect(roundScore(2.5, 0, "half_even")).toBe(2);
    expect(roundScore(3.5, 0, "half_even")).toBe(4);
  });

  it("rejects non-finite values instead of inventing zero", () => {
    expect(() => roundScore(Number.NaN, 2)).toThrow(/non-finite/);
  });

  it("rounds half_up by default", () => {
    expect(roundScore(2.5, 0, "half_up")).toBe(3);
    expect(roundScore(2.4, 0, "half_up")).toBe(2);
  });

  it("supports floor and ceil modes", () => {
    expect(roundScore(2.9, 0, "floor")).toBe(2);
    expect(roundScore(2.1, 0, "ceil")).toBe(3);
  });

  it("converts marks to percentage using max marks", () => {
    expect(marksToPercentage(40, 80, { decimalPlaces: 0 })).toBe(50);
    expect(marksToPercentage(null, 80)).toBeNull();
    expect(marksToPercentage(10, 0)).toBeNull();
  });
});

describe("results engine grade lookup", () => {
  it("maps boundary scores inclusively", () => {
    expect(lookupGradeBand(80, SCHEME)?.grade_code).toBe("A");
    expect(lookupGradeBand(79, SCHEME)?.grade_code).toBe("B");
    expect(lookupGradeBand(50, SCHEME)?.grade_code).toBe("D");
    expect(lookupGradeBand(49, SCHEME)?.grade_code).toBe("F");
  });

  it("returns remarks from band configuration", () => {
    expect(lookupGradeBand(85, SCHEME)?.remark).toBe("Excellent");
    expect(lookupGradeBand(45, SCHEME)?.remark).toBe("Needs Improvement");
  });

  it("detects coverage gaps", () => {
    const gaps = bandCoverageGaps(
      [
        {
          minimum_score: 60,
          maximum_score: 100,
          grade_code: "P",
          grade_label: "Pass",
          grade_point: 1,
          performance_description: null,
          is_pass: true,
          display_order: 1,
        },
      ],
      0,
      100,
    );
    expect(gaps.some((g) => g.from === 0 && g.to === 60)).toBe(true);
  });

  it("does not invent gaps between adjacent integer bands", () => {
    const gaps = bandCoverageGaps(SCHEME.bands, 0, 100);
    expect(gaps).toEqual([]);
  });
});

describe("results engine exam computation", () => {
  it("computes scored exam with grade and pass flag", () => {
    const result = computeExamResult(
      {
        student_id: "s1",
        entry_status: "SCORED",
        marks_obtained: 75,
        max_marks: 100,
      },
      SCHEME,
    );
    expect(result.percentage).toBe(75);
    expect(result.grade_code).toBe("B");
    expect(result.is_pass).toBe(true);
    expect(result.remark).toBe("Very Good");
  });

  it("keeps ABSENT non-countable by default", () => {
    const result = computeExamResult(
      {
        student_id: "s1",
        entry_status: "ABSENT",
        marks_obtained: null,
        max_marks: 100,
      },
      SCHEME,
    );
    expect(result.percentage).toBeNull();
    expect(result.grade_code).toBeNull();
  });

  it("treats ABSENT as zero when configured", () => {
    const result = computeExamResult(
      {
        student_id: "s1",
        entry_status: "ABSENT",
        marks_obtained: null,
        max_marks: 100,
      },
      SCHEME,
      {
        ranking_enabled: true,
        ranking_tie_mode: "COMPETITION",
        treat_absent_as_zero: true,
        include_exempt_in_average: false,
        include_not_assessed_in_average: false,
      },
    );
    expect(result.percentage).toBe(0);
    expect(result.grade_code).toBe("F");
  });

  it("never invents percentages for EXEMPT or NOT_ASSESSED", () => {
    for (const entry_status of ["EXEMPT", "NOT_ASSESSED"] as const) {
      const result = computeExamResult(
        {
          student_id: "s1",
          entry_status,
          marks_obtained: null,
          max_marks: 100,
        },
        SCHEME,
        {
          ranking_enabled: true,
          ranking_tie_mode: "COMPETITION",
          treat_absent_as_zero: true,
          include_exempt_in_average: true,
          include_not_assessed_in_average: true,
        },
      );
      expect(result.percentage).toBeNull();
      expect(result.grade_code).toBeNull();
      expect(result.is_pass).toBeNull();
    }
  });
});

describe("results engine ranking", () => {
  it("handles competition ties (1,2,2,4)", () => {
    const ranks = rankScores(
      [
        { id: "a", score: 90 },
        { id: "b", score: 80 },
        { id: "c", score: 80 },
        { id: "d", score: 70 },
      ],
      "COMPETITION",
    );
    expect(ranks.find((r) => r.id === "a")?.position).toBe(1);
    expect(ranks.find((r) => r.id === "b")?.position).toBe(2);
    expect(ranks.find((r) => r.id === "c")?.position).toBe(2);
    expect(ranks.find((r) => r.id === "d")?.position).toBe(4);
    expect(ranks.find((r) => r.id === "b")?.tied_count).toBe(2);
  });

  it("handles dense ties (1,2,2,3)", () => {
    const ranks = rankScores(
      [
        { id: "a", score: 90 },
        { id: "b", score: 80 },
        { id: "c", score: 80 },
        { id: "d", score: 70 },
      ],
      "DENSE",
    );
    expect(ranks.find((r) => r.id === "d")?.position).toBe(3);
  });

  it("handles average ties for 100,90,90,80 → 1,2.5,2.5,4", () => {
    const ranks = rankScores(
      [
        { id: "a", score: 100 },
        { id: "b", score: 90 },
        { id: "c", score: 90 },
        { id: "d", score: 80 },
      ],
      "AVERAGE",
    );
    expect(ranks.find((r) => r.id === "a")?.position).toBe(1);
    expect(ranks.find((r) => r.id === "b")?.position).toBe(2.5);
    expect(ranks.find((r) => r.id === "c")?.position).toBe(2.5);
    expect(ranks.find((r) => r.id === "d")?.position).toBe(4);
  });

  it("keeps zero scores ranked and does not break ties by id", () => {
    const ranks = rankScores(
      [
        { id: "z", score: 0 },
        { id: "a", score: 0 },
      ],
      "COMPETITION",
    );
    expect(ranks.find((r) => r.id === "a")?.position).toBe(1);
    expect(ranks.find((r) => r.id === "z")?.position).toBe(1);
    expect(ranks.find((r) => r.id === "a")?.tied_count).toBe(2);
  });

  it("disables ranking when requested", () => {
    const ranks = rankScores([{ id: "a", score: 90 }], "DISABLED");
    expect(ranks[0].position).toBeNull();
  });

  it("leaves null scores unranked", () => {
    const ranks = rankScores(
      [
        { id: "a", score: 90 },
        { id: "b", score: null },
      ],
      "COMPETITION",
    );
    expect(ranks.find((r) => r.id === "b")?.position).toBeNull();
  });
});

describe("results engine statistics", () => {
  it("computes median for odd and even sets", () => {
    expect(computeMedian([1, 3, 2])).toBe(2);
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes unimodal mode and null for multimodal", () => {
    expect(computeMode([1, 2, 2, 3])).toBe(2);
    expect(computeMode([1, 1, 2, 2])).toBeNull();
  });

  it("summarizes pass rate and distribution", () => {
    const summary = summarizeStatistics([
      { value: 80, is_pass: true, grade_code: "A", grade_label: "Distinction" },
      { value: 40, is_pass: false, grade_code: "F", grade_label: "Fail" },
      { value: 60, is_pass: true, grade_code: "C", grade_label: "Credit" },
    ]);
    expect(summary.average).toBe(60);
    expect(summary.pass_rate).toBe(66.67);
    expect(summary.distribution).toHaveLength(3);
  });

  it("handles empty and single-value sets safely", () => {
    const empty = summarizeStatistics([]);
    expect(empty.count).toBe(0);
    expect(empty.average).toBeNull();
    expect(empty.standard_deviation).toBeNull();
    expect(empty.pass_rate).toBeNull();

    const one = summarizeStatistics([
      { value: 0, is_pass: false, grade_code: "F", grade_label: "Fail" },
    ]);
    expect(one.lowest).toBe(0);
    expect(one.highest).toBe(0);
    expect(one.standard_deviation).toBeNull();
    expect(Number.isFinite(one.average as number)).toBe(true);
  });
});

describe("results engine weighting", () => {
  it("renormalizes weights over available components", () => {
    const pct = computeWeightedPercentage([
      {
        assessment_type_id: "exam",
        weight_percentage: 70,
        percentage: 80,
        countable: true,
      },
      {
        assessment_type_id: "ca",
        weight_percentage: 30,
        percentage: null,
        countable: false,
      },
    ]);
    expect(pct).toBe(80);
  });

  it("equal-weight averages ignore nulls", () => {
    expect(equalWeightAverage([80, null, 60], { decimalPlaces: 0 })).toBe(70);
  });
});

describe("results engine promotion", () => {
  it("promotes when min average met", () => {
    const decision = evaluatePromotion(
      {
        average_percentage: 55,
        passed_subject_count: 4,
        failed_subject_count: 1,
        scored_subject_count: 5,
        subject_count: 5,
      },
      defaultPromotionRules(),
    );
    expect(decision.outcome).toBe("PROMOTED");
  });

  it("returns conditional when average fails but fail-count rule matches", () => {
    const decision = evaluatePromotion(
      {
        average_percentage: 40,
        passed_subject_count: 3,
        failed_subject_count: 2,
        scored_subject_count: 5,
        subject_count: 5,
      },
      defaultPromotionRules(),
    );
    expect(decision.outcome).toBe("CONDITIONAL");
  });

  it("falls through to repeat", () => {
    const decision = evaluatePromotion(
      {
        average_percentage: 30,
        passed_subject_count: 1,
        failed_subject_count: 4,
        scored_subject_count: 5,
        subject_count: 5,
      },
      defaultPromotionRules(),
    );
    expect(decision.outcome).toBe("REPEAT");
  });

  it("returns undecided with empty rules", () => {
    expect(
      evaluatePromotion(
        {
          average_percentage: 90,
          passed_subject_count: 5,
          failed_subject_count: 0,
          scored_subject_count: 5,
          subject_count: 5,
        },
        [],
      ).outcome,
    ).toBe("UNDECIDED");
  });

  it("skips GRADUATED unless terminal grade is explicitly true", () => {
    const rules = [
      {
        rule_type: "ALWAYS" as const,
        outcome: "GRADUATED" as const,
        threshold_numeric: null,
        threshold_int: null,
        priority: 1,
        label: "Graduate",
      },
    ];
    expect(
      evaluatePromotion(
        {
          average_percentage: 90,
          passed_subject_count: 5,
          failed_subject_count: 0,
          scored_subject_count: 5,
          subject_count: 5,
        },
        rules,
      ).outcome,
    ).toBe("UNDECIDED");
    expect(
      evaluatePromotion(
        {
          average_percentage: 90,
          passed_subject_count: 5,
          failed_subject_count: 0,
          scored_subject_count: 5,
          subject_count: 5,
          is_terminal_grade: false,
        },
        rules,
      ).outcome,
    ).toBe("UNDECIDED");
    expect(
      evaluatePromotion(
        {
          average_percentage: 90,
          passed_subject_count: 5,
          failed_subject_count: 0,
          scored_subject_count: 5,
          subject_count: 5,
          is_terminal_grade: true,
        },
        rules,
      ).outcome,
    ).toBe("GRADUATED");
  });

  it("uses ascending priority for conflict resolution", () => {
    const decision = evaluatePromotion(
      {
        average_percentage: 90,
        passed_subject_count: 5,
        failed_subject_count: 0,
        scored_subject_count: 5,
        subject_count: 5,
      },
      [
        {
          rule_type: "ALWAYS",
          outcome: "REPEAT",
          threshold_numeric: null,
          threshold_int: null,
          priority: 50,
          label: "later",
        },
        {
          rule_type: "MIN_AVERAGE",
          outcome: "PROMOTED",
          threshold_numeric: 50,
          threshold_int: null,
          priority: 10,
          label: "first",
        },
      ],
    );
    expect(decision.outcome).toBe("PROMOTED");
    expect(decision.matched_rule_priority).toBe(10);
  });
});

describe("results engine aggregation + recalculation", () => {
  it("aggregates subject and applies positions", () => {
    const s1 = aggregateSubjectResult({
      student_id: "s1",
      subject_id: "math",
      assessments: [
        {
          assessment_type_id: "exam",
          raw: {
            student_id: "s1",
            entry_status: "SCORED",
            marks_obtained: 90,
            max_marks: 100,
          },
        },
      ],
      scheme: SCHEME,
    });
    const s2 = aggregateSubjectResult({
      student_id: "s2",
      subject_id: "math",
      assessments: [
        {
          assessment_type_id: "exam",
          raw: {
            student_id: "s2",
            entry_status: "SCORED",
            marks_obtained: 70,
            max_marks: 100,
          },
        },
      ],
      scheme: SCHEME,
    });
    const ranked = applySubjectPositions([s1, s2]);
    expect(ranked.find((r) => r.student_id === "s1")?.subject_position).toBe(1);
    expect(ranked.find((r) => r.student_id === "s2")?.subject_position).toBe(2);
  });

  it("builds term results with promotion and overall rank", () => {
    const subjects = [
      aggregateSubjectResult({
        student_id: "s1",
        subject_id: "math",
        assessments: [
          {
            assessment_type_id: "exam",
            raw: {
              student_id: "s1",
              entry_status: "SCORED",
              marks_obtained: 80,
              max_marks: 100,
            },
          },
        ],
        scheme: SCHEME,
      }),
      aggregateSubjectResult({
        student_id: "s1",
        subject_id: "eng",
        assessments: [
          {
            assessment_type_id: "exam",
            raw: {
              student_id: "s1",
              entry_status: "SCORED",
              marks_obtained: 60,
              max_marks: 100,
            },
          },
        ],
        scheme: SCHEME,
      }),
    ];
    const term = aggregateTermResult({
      student_id: "s1",
      subjects,
      scheme: SCHEME,
      promotionRules: defaultPromotionRules(),
    });
    expect(term.average_percentage).toBe(70);
    expect(term.promotion_outcome).toBe("PROMOTED");

    const ranked = applyOverallPositions([
      term,
      {
        ...term,
        student_id: "s2",
        average_percentage: 90,
      },
    ]);
    expect(ranked.find((r) => r.student_id === "s2")?.overall_position).toBe(1);
    expect(ranked.find((r) => r.student_id === "s1")?.overall_position).toBe(2);
  });

  it("recalculates a class term end-to-end", () => {
    const output = recalculateClassTerm({
      scheme: SCHEME,
      promotionRules: defaultPromotionRules(),
      examMarks: [
        {
          student_id: "s1",
          subject_id: "math",
          assessment_type_id: "exam",
          raw: {
            student_id: "s1",
            entry_status: "SCORED",
            marks_obtained: 85,
            max_marks: 100,
          },
        },
        {
          student_id: "s2",
          subject_id: "math",
          assessment_type_id: "exam",
          raw: {
            student_id: "s2",
            entry_status: "SCORED",
            marks_obtained: 40,
            max_marks: 100,
          },
        },
      ],
    });
    expect(output.exam_results).toHaveLength(2);
    expect(output.term_results).toHaveLength(2);
    expect(output.class_statistics.countable).toBe(2);
    expect(output.subject_statistics.math.highest).toBe(85);
  });

  it("rejects duplicate assessment types for the same subject", () => {
    expect(() =>
      aggregateSubjectResult({
        student_id: "s1",
        subject_id: "math",
        assessments: [
          {
            assessment_type_id: "exam",
            raw: {
              student_id: "s1",
              entry_status: "SCORED",
              marks_obtained: 80,
              max_marks: 100,
            },
          },
          {
            assessment_type_id: "exam",
            raw: {
              student_id: "s1",
              entry_status: "SCORED",
              marks_obtained: 60,
              max_marks: 100,
            },
          },
        ],
        scheme: SCHEME,
      }),
    ).toThrow(/Duplicate assessment_type_id/);
  });

  it("omits EXEMPT components from weighted subject averages", () => {
    const result = aggregateSubjectResult({
      student_id: "s1",
      subject_id: "math",
      assessments: [
        {
          assessment_type_id: "exam",
          raw: {
            student_id: "s1",
            entry_status: "SCORED",
            marks_obtained: 80,
            max_marks: 100,
          },
        },
        {
          assessment_type_id: "ca",
          raw: {
            student_id: "s1",
            entry_status: "EXEMPT",
            marks_obtained: null,
            max_marks: 100,
          },
        },
      ],
      scheme: SCHEME,
      weights: [
        { assessment_type_id: "exam", weight_percentage: 70 },
        { assessment_type_id: "ca", weight_percentage: 30 },
      ],
    });
    expect(result.weighted_percentage).toBe(80);
  });
});

describe("results permissions", () => {
  it("allows admin and head full results access", () => {
    expect(canOpenResults("administrator")).toBe(true);
    expect(canViewAllResults("headteacher")).toBe(true);
    expect(canRecalculateResults("headteacher")).toBe(true);
    expect(canManagePromotionPolicies("administrator")).toBe(true);
  });

  it("allows teachers view but not recalculate by default", () => {
    expect(canOpenResults("teacher")).toBe(true);
    expect(canViewAllResults("teacher")).toBe(false);
    expect(canRecalculateResults("teacher")).toBe(false);
  });

  it("excludes secretary and bursar by default", () => {
    expect(canOpenResults("secretary")).toBe(false);
    expect(canOpenResults("bursar")).toBe(false);
    expect(hasResultsCapability("secretary", "RESULTS_VIEW_ALL")).toBe(false);
  });
});
