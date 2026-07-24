/**
 * Phase 2D.1 — Academic Results Engine types.
 * Pure calculation contracts; no DB I/O.
 */

export type RoundingMode = "half_up" | "half_even" | "floor" | "ceil";

export type RankingTieMode = "COMPETITION" | "DENSE" | "AVERAGE" | "DISABLED";

export type PromotionOutcome =
  | "PROMOTED"
  | "CONDITIONAL"
  | "REPEAT"
  | "GRADUATED"
  | "UNDECIDED";

export type ResultEntryStatus =
  | "SCORED"
  | "ABSENT"
  | "EXEMPT"
  | "NOT_ASSESSED";

export type GradingBand = {
  minimum_score: number;
  maximum_score: number;
  grade_code: string;
  grade_label: string;
  grade_point: number | null;
  performance_description: string | null;
  is_pass: boolean;
  display_order: number;
};

export type GradingSchemeInput = {
  id: string;
  version: number;
  min_score: number;
  max_score: number;
  decimal_places: number;
  rounding_mode: RoundingMode | string;
  bands: GradingBand[];
};

export type RawMarkInput = {
  student_id: string;
  entry_status: ResultEntryStatus;
  marks_obtained: number | null;
  max_marks: number;
};

export type ExamResultComputed = {
  student_id: string;
  entry_status: ResultEntryStatus;
  marks_obtained: number | null;
  max_marks: number;
  /** null when not scored / not countable */
  percentage: number | null;
  grade_code: string | null;
  grade_label: string | null;
  grade_point: number | null;
  is_pass: boolean | null;
  remark: string | null;
  grading_scheme_id: string;
  grading_scheme_version: number;
};

export type WeightedComponent = {
  assessment_type_id: string;
  weight_percentage: number;
  percentage: number | null;
  /** SCORED contributions only count toward weighted average by default */
  countable: boolean;
};

export type SubjectResultComputed = {
  student_id: string;
  subject_id: string;
  components: WeightedComponent[];
  weighted_percentage: number | null;
  grade_code: string | null;
  grade_label: string | null;
  grade_point: number | null;
  is_pass: boolean | null;
  remark: string | null;
  subject_position: number | null;
  tied_count: number;
};

export type TermResultComputed = {
  student_id: string;
  subject_count: number;
  scored_subject_count: number;
  passed_subject_count: number;
  failed_subject_count: number;
  average_percentage: number | null;
  grade_code: string | null;
  grade_label: string | null;
  grade_point: number | null;
  is_pass: boolean | null;
  remark: string | null;
  overall_position: number | null;
  tied_count: number;
  promotion_outcome: PromotionOutcome;
  promotion_reason: string | null;
};

export type RankableScore = {
  id: string;
  score: number | null;
};

export type RankResult = {
  id: string;
  position: number | null;
  tied_count: number;
};

export type DistributionBucket = {
  grade_code: string;
  grade_label: string;
  count: number;
  percentage: number;
};

export type StatisticsSummary = {
  count: number;
  countable: number;
  highest: number | null;
  lowest: number | null;
  average: number | null;
  median: number | null;
  mode: number | null;
  standard_deviation: number | null;
  pass_count: number;
  fail_count: number;
  pass_rate: number | null;
  fail_rate: number | null;
  distribution: DistributionBucket[];
};

export type PromotionRuleType =
  | "MIN_AVERAGE"
  | "MIN_PASS_SUBJECTS"
  | "MAX_FAIL_SUBJECTS"
  | "MIN_PASS_RATE"
  | "ALWAYS";

export type PromotionRule = {
  id?: string;
  rule_type: PromotionRuleType;
  outcome: Exclude<PromotionOutcome, "UNDECIDED">;
  /** Numeric threshold (average %, pass rate 0–100) */
  threshold_numeric: number | null;
  /** Integer threshold (subject counts) */
  threshold_int: number | null;
  priority: number;
  label?: string | null;
};

export type PromotionContext = {
  average_percentage: number | null;
  passed_subject_count: number;
  failed_subject_count: number;
  scored_subject_count: number;
  subject_count: number;
  /** true when student is in a terminal grade (e.g. final year) */
  is_terminal_grade?: boolean;
};

export type ResultsEngineSettings = {
  ranking_enabled: boolean;
  ranking_tie_mode: RankingTieMode;
  /** ABSENT counts as scheme minimum when true */
  treat_absent_as_zero: boolean;
  /**
   * Reserved. EXEMPT never invents a numeric percentage; averages omit nulls.
   * Kept for forward-compatible settings rows.
   */
  include_exempt_in_average: boolean;
  /**
   * Reserved. NOT_ASSESSED never invents a numeric percentage; averages omit nulls.
   */
  include_not_assessed_in_average: boolean;
};

/** Bump when calculation semantics change in a way that invalidates snapshots. */
export const RESULTS_ENGINE_VERSION = "2d.1.1";
