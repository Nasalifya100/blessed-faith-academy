/**
 * Best-effort in-isolate rate limiting for Cloudflare Workers.
 * Limits are not shared across isolates; document fail-open fallback.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  store: "memory" | "unavailable";
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const MAX_KEYS = 5_000;

function pruneIfNeeded(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size < MAX_KEYS * 0.8) break;
  }
  // Hard cap: drop oldest arbitrary entries if still over.
  if (buckets.size >= MAX_KEYS) {
    const keys = [...buckets.keys()].slice(0, Math.floor(MAX_KEYS / 5));
    for (const key of keys) buckets.delete(key);
  }
}

/**
 * Sliding fixed-window limiter.
 * On unexpected store failure, returns allowed=true (fail-open) with store=unavailable.
 */
export function checkRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  try {
    const now = input.now ?? Date.now();
    pruneIfNeeded(now);
    const existing = buckets.get(input.key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(input.key, {
        count: 1,
        resetAt: now + input.windowMs,
      });
      return {
        allowed: true,
        remaining: Math.max(0, input.limit - 1),
        retryAfterSeconds: Math.ceil(input.windowMs / 1000),
        store: "memory",
      };
    }
    if (existing.count >= input.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
        store: "memory",
      };
    }
    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, input.limit - existing.count),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
      store: "memory",
    };
  } catch {
    return {
      allowed: true,
      remaining: input.limit,
      retryAfterSeconds: 0,
      store: "unavailable",
    };
  }
}

/** Test helper — clear isolate buckets. */
export function resetRateLimitStoreForTests(): void {
  buckets.clear();
}

export const RATE_LIMIT_PROFILES = {
  // Sized for one-school exam-week / staff-onboarding throughput without
  // enabling unbounded abuse. Keys are per authenticated actor.
  passwordReset: { limit: 30, windowMs: 15 * 60_000 },
  reportCardBulk: { limit: 60, windowMs: 15 * 60_000 },
  resultRecalc: { limit: 60, windowMs: 15 * 60_000 },
  export: { limit: 30, windowMs: 15 * 60_000 },
  publicForm: { limit: 20, windowMs: 15 * 60_000 },
} as const;

/** Minimum floors used by regression tests — do not lower profiles below these. */
export const RATE_LIMIT_SCHOOL_SAFE_FLOORS = {
  passwordReset: 20,
  reportCardBulk: 40,
  resultRecalc: 40,
} as const;
