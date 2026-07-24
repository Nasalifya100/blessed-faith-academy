/**
 * Phase 2D.1 — rounding + percentage helpers for the results engine.
 */

import type { RoundingMode } from "@/features/results/types";

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Round `value` to `decimalPlaces` using scheme rounding modes.
 * Default: half_up (school common).
 */
export function roundScore(
  value: number,
  decimalPlaces: number,
  mode: RoundingMode | string = "half_up",
): number {
  if (!Number.isFinite(value)) {
    throw new Error("Cannot round a non-finite score.");
  }
  const places = Math.max(0, Math.min(6, Math.trunc(decimalPlaces)));
  const factor = 10 ** places;

  switch (mode) {
    case "floor":
      return Math.floor(value * factor) / factor;
    case "ceil":
      return Math.ceil(value * factor) / factor;
    case "half_even": {
      // Banker's rounding toward even on exact .5
      const scaled = value * factor;
      const floored = Math.floor(scaled);
      const diff = scaled - floored;
      if (diff > 0.5) return (floored + 1) / factor;
      if (diff < 0.5) return floored / factor;
      return (floored % 2 === 0 ? floored : floored + 1) / factor;
    }
    case "half_up":
    default: {
      const scaled = value * factor;
      return Math.round(scaled) / factor;
    }
  }
}

/**
 * Convert raw marks to a percentage on the scheme scale (typically 0–100).
 * Returns null when marks cannot form a percentage.
 */
export function marksToPercentage(
  marksObtained: number | null | undefined,
  maxMarks: number,
  options?: {
    decimalPlaces?: number;
    roundingMode?: RoundingMode | string;
    schemeMin?: number;
    schemeMax?: number;
  },
): number | null {
  if (marksObtained == null || !Number.isFinite(marksObtained)) return null;
  if (!Number.isFinite(maxMarks) || maxMarks <= 0) return null;

  const schemeMin = options?.schemeMin ?? 0;
  const schemeMax = options?.schemeMax ?? 100;
  const span = schemeMax - schemeMin;
  if (span <= 0) return null;

  const ratio = marksObtained / maxMarks;
  const raw = schemeMin + ratio * span;
  return roundScore(
    clampNumber(raw, schemeMin, schemeMax),
    options?.decimalPlaces ?? 2,
    options?.roundingMode ?? "half_up",
  );
}
