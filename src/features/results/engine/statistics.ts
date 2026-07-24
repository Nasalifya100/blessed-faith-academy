/**
 * Phase 2D.1 — descriptive statistics for class/subject result sets.
 */

import { roundScore } from "@/features/results/engine/rounding";
import type {
  DistributionBucket,
  StatisticsSummary,
} from "@/features/results/types";

export type StatObservation = {
  value: number | null;
  is_pass?: boolean | null;
  grade_code?: string | null;
  grade_label?: string | null;
};

function sortedFinite(values: number[]): number[] {
  return [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

export function computeMedian(values: number[]): number | null {
  const sorted = sortedFinite(values);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeMode(values: number[]): number | null {
  const sorted = sortedFinite(values);
  if (sorted.length === 0) return null;
  const freq = new Map<number, number>();
  for (const v of sorted) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  let multi = false;
  for (const [value, count] of freq) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      multi = false;
    } else if (count === bestCount) {
      multi = true;
    }
  }
  // Unimodal only; multimodal → null (deterministic, documented).
  if (multi && bestCount > 1) return null;
  if (bestCount <= 1 && sorted.length > 1) return null;
  return best;
}

export function computeStandardDeviation(values: number[]): number | null {
  const sorted = sortedFinite(values);
  if (sorted.length < 2) return null;
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const variance =
    sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (sorted.length - 1);
  return Math.sqrt(variance);
}

export function summarizeStatistics(
  observations: StatObservation[],
  options?: { decimalPlaces?: number },
): StatisticsSummary {
  const places = options?.decimalPlaces ?? 2;
  const countableValues = observations
    .map((o) => o.value)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const passCount = observations.filter((o) => o.is_pass === true).length;
  const failCount = observations.filter((o) => o.is_pass === false).length;
  const judged = passCount + failCount;

  const distMap = new Map<string, DistributionBucket>();
  for (const o of observations) {
    if (!o.grade_code) continue;
    const key = o.grade_code;
    const existing = distMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      distMap.set(key, {
        grade_code: o.grade_code,
        grade_label: o.grade_label ?? o.grade_code,
        count: 1,
        percentage: 0,
      });
    }
  }
  const distribution = [...distMap.values()].map((b) => ({
    ...b,
    percentage:
      observations.length === 0
        ? 0
        : roundScore((b.count / observations.length) * 100, places),
  }));

  const average =
    countableValues.length === 0
      ? null
      : roundScore(
          countableValues.reduce((s, v) => s + v, 0) / countableValues.length,
          places,
        );

  const medianRaw = computeMedian(countableValues);
  const modeRaw = computeMode(countableValues);
  const sdRaw = computeStandardDeviation(countableValues);

  return {
    count: observations.length,
    countable: countableValues.length,
    highest:
      countableValues.length === 0
        ? null
        : roundScore(Math.max(...countableValues), places),
    lowest:
      countableValues.length === 0
        ? null
        : roundScore(Math.min(...countableValues), places),
    average,
    median: medianRaw == null ? null : roundScore(medianRaw, places),
    mode: modeRaw == null ? null : roundScore(modeRaw, places),
    standard_deviation: sdRaw == null ? null : roundScore(sdRaw, places),
    pass_count: passCount,
    fail_count: failCount,
    pass_rate:
      judged === 0 ? null : roundScore((passCount / judged) * 100, places),
    fail_rate:
      judged === 0 ? null : roundScore((failCount / judged) * 100, places),
    distribution,
  };
}
