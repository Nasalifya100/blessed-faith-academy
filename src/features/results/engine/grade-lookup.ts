/**
 * Phase 2D.1 — grading scheme band lookup + remarks.
 * No hardcoded school bands; consumes configured scheme only.
 */

import { roundScore } from "@/features/results/engine/rounding";
import type {
  GradingBand,
  GradingSchemeInput,
} from "@/features/results/types";

export type GradeLookupResult = {
  band: GradingBand;
  grade_code: string;
  grade_label: string;
  grade_point: number | null;
  is_pass: boolean;
  remark: string | null;
};

function normalizeBands(bands: GradingBand[]): GradingBand[] {
  return [...bands].sort((a, b) => {
    if (a.display_order !== b.display_order) {
      return a.display_order - b.display_order;
    }
    return b.minimum_score - a.minimum_score;
  });
}

/**
 * Find the band containing percentage (inclusive on both ends).
 * Prefer highest minimum_score match when overlaps exist (should not in valid schemes).
 */
export function lookupGradeBand(
  percentage: number,
  scheme: GradingSchemeInput,
): GradeLookupResult | null {
  if (!Number.isFinite(percentage) || scheme.bands.length === 0) return null;

  const score = roundScore(
    percentage,
    scheme.decimal_places,
    scheme.rounding_mode,
  );

  const bands = normalizeBands(scheme.bands);
  const matches = bands.filter(
    (b) => score >= b.minimum_score && score <= b.maximum_score,
  );
  if (matches.length === 0) return null;

  matches.sort((a, b) => b.minimum_score - a.minimum_score);
  const band = matches[0];
  return {
    band,
    grade_code: band.grade_code,
    grade_label: band.grade_label,
    grade_point: band.grade_point,
    is_pass: band.is_pass,
    remark: band.performance_description,
  };
}

/** Derive automatic remark from band; teachers may override later (2D.2+). */
export function deriveRemark(
  percentage: number | null,
  scheme: GradingSchemeInput,
): string | null {
  if (percentage == null) return null;
  return lookupGradeBand(percentage, scheme)?.remark ?? null;
}

export function bandCoverageGaps(
  bands: GradingBand[],
  schemeMin = 0,
  schemeMax = 100,
): Array<{ from: number; to: number }> {
  if (bands.length === 0) {
    return [{ from: schemeMin, to: schemeMax }];
  }
  const sorted = [...bands].sort((a, b) => a.minimum_score - b.minimum_score);
  const gaps: Array<{ from: number; to: number }> = [];
  let cursor = schemeMin;
  for (const band of sorted) {
    // Inclusive bands [0,49] then [50,100] are contiguous for integer scores
    // (next min === previous max + 1). Overlap/touch (next min <= cursor) is fine.
    if (
      band.minimum_score > cursor &&
      band.minimum_score !== cursor + 1
    ) {
      gaps.push({ from: cursor, to: band.minimum_score });
    }
    cursor = Math.max(cursor, band.maximum_score);
  }
  if (cursor < schemeMax) {
    gaps.push({ from: cursor, to: schemeMax });
  }
  return gaps;
}
