/**
 * Phase 2D.1 — data-driven promotion recommendations.
 * Emits recommendations only; no auto-enrolment changes.
 */

import type {
  PromotionContext,
  PromotionOutcome,
  PromotionRule,
} from "@/features/results/types";

export type PromotionDecision = {
  outcome: PromotionOutcome;
  reason: string;
  matched_rule_priority: number | null;
};

function ruleLabel(rule: PromotionRule): string {
  return rule.label?.trim() || `${rule.rule_type} → ${rule.outcome}`;
}

function ruleMatches(rule: PromotionRule, ctx: PromotionContext): boolean {
  switch (rule.rule_type) {
    case "ALWAYS":
      return true;
    case "MIN_AVERAGE": {
      if (ctx.average_percentage == null || rule.threshold_numeric == null) {
        return false;
      }
      return ctx.average_percentage >= rule.threshold_numeric;
    }
    case "MIN_PASS_SUBJECTS": {
      if (rule.threshold_int == null) return false;
      return ctx.passed_subject_count >= rule.threshold_int;
    }
    case "MAX_FAIL_SUBJECTS": {
      if (rule.threshold_int == null) return false;
      return ctx.failed_subject_count <= rule.threshold_int;
    }
    case "MIN_PASS_RATE": {
      if (rule.threshold_numeric == null || ctx.scored_subject_count <= 0) {
        return false;
      }
      const rate =
        (ctx.passed_subject_count / ctx.scored_subject_count) * 100;
      return rate >= rule.threshold_numeric;
    }
    default:
      return false;
  }
}

/**
 * Evaluate rules in ascending priority (lower number first).
 * First matching rule wins. No match → UNDECIDED.
 * Terminal-grade + GRADUATED outcome is allowed when rule says so;
 * callers may force terminal context.
 */
export function evaluatePromotion(
  ctx: PromotionContext,
  rules: PromotionRule[],
): PromotionDecision {
  if (!rules.length) {
    return {
      outcome: "UNDECIDED",
      reason: "No promotion policy rules configured.",
      matched_rule_priority: null,
    };
  }

  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (!ruleMatches(rule, ctx)) continue;
    // GRADUATED only when caller explicitly marks a terminal grade.
    if (rule.outcome === "GRADUATED" && ctx.is_terminal_grade !== true) {
      continue;
    }
    return {
      outcome: rule.outcome,
      reason: ruleLabel(rule),
      matched_rule_priority: rule.priority,
    };
  }

  return {
    outcome: "UNDECIDED",
    reason: "No promotion rule matched.",
    matched_rule_priority: null,
  };
}

/** Sensible default policy (data template — schools should customize). */
export function defaultPromotionRules(): PromotionRule[] {
  return [
    {
      rule_type: "MIN_AVERAGE",
      outcome: "PROMOTED",
      threshold_numeric: 50,
      threshold_int: null,
      priority: 10,
      label: "Average at least 50%",
    },
    {
      rule_type: "MAX_FAIL_SUBJECTS",
      outcome: "CONDITIONAL",
      threshold_numeric: null,
      threshold_int: 2,
      priority: 20,
      label: "At most 2 failed subjects → conditional",
    },
    {
      rule_type: "ALWAYS",
      outcome: "REPEAT",
      threshold_numeric: null,
      threshold_int: null,
      priority: 100,
      label: "Default: repeat",
    },
  ];
}
