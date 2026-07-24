/**
 * Phase 2D.1 — assessment weight application (future-ready weighted averages).
 */

import { roundScore } from "@/features/results/engine/rounding";
import type { WeightedComponent } from "@/features/results/types";

export type WeightItem = {
  assessment_type_id: string;
  weight_percentage: number;
};

/**
 * Resolve weighted subject percentage from component percentages.
 * Only countable components with non-null percentages contribute.
 * Weights are renormalized over available countable components so partial
 * assessment sets still produce a fair interim average (documented).
 */
export function computeWeightedPercentage(
  components: WeightedComponent[],
  options?: { decimalPlaces?: number },
): number | null {
  const places = options?.decimalPlaces ?? 2;
  const usable = components.filter(
    (c) => c.countable && c.percentage != null && c.weight_percentage > 0,
  );
  if (usable.length === 0) return null;

  const weightSum = usable.reduce((s, c) => s + c.weight_percentage, 0);
  if (weightSum <= 0) return null;

  const weighted = usable.reduce(
    (s, c) => s + (c.percentage as number) * (c.weight_percentage / weightSum),
    0,
  );
  return roundScore(weighted, places);
}

/**
 * Map assessment-type percentages + scheme weights into components.
 * Missing assessment types are omitted (not zero-filled) unless caller adds them.
 */
export function buildWeightedComponents(
  weights: WeightItem[],
  percentagesByType: Record<
    string,
    { percentage: number | null; countable: boolean }
  >,
): WeightedComponent[] {
  return weights.map((w) => {
    const hit = percentagesByType[w.assessment_type_id];
    return {
      assessment_type_id: w.assessment_type_id,
      weight_percentage: w.weight_percentage,
      percentage: hit?.percentage ?? null,
      countable: hit?.countable ?? false,
    };
  });
}

/** Equal-weight average when no weight scheme is configured. */
export function equalWeightAverage(
  percentages: Array<number | null>,
  options?: { decimalPlaces?: number },
): number | null {
  const values = percentages.filter(
    (p): p is number => p != null && Number.isFinite(p),
  );
  if (values.length === 0) return null;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return roundScore(avg, options?.decimalPlaces ?? 2);
}
