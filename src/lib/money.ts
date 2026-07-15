/**
 * Money helpers for ZMW amounts stored as numeric(12,2).
 * Ledger math uses integer ngwee (1 Kwacha = 100 ngwee) to avoid float drift.
 */

/** Format ZMW amounts consistently (avoids SSR/client locale mismatches). */
export function formatKwacha(amount: number): string {
  return `K${amount.toLocaleString("en-ZM", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Parse a DB numeric / form value into ngwee (rounded to nearest). */
export function toNgwee(amount: number | string | null | undefined): number {
  if (amount == null || amount === "") return 0;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Convert ngwee back to Kwacha (2 dp). */
export function fromNgwee(ngwee: number): number {
  return ngwee / 100;
}

/** Sum amounts as ngwee, return Kwacha. */
export function sumKwacha(
  amounts: readonly (number | string | null | undefined)[],
): number {
  let total = 0;
  for (const amount of amounts) {
    total += toNgwee(amount);
  }
  return fromNgwee(total);
}

/** Add two Kwacha amounts via ngwee. */
export function addKwacha(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
): number {
  return fromNgwee(toNgwee(a) + toNgwee(b));
}

/** Subtract Kwacha amounts via ngwee (a - b). */
export function subKwacha(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
): number {
  return fromNgwee(toNgwee(a) - toNgwee(b));
}
