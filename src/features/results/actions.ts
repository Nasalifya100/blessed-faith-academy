"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomUUID } from "node:crypto";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { recalculateClassTerm } from "@/features/results/engine/aggregation";
import { defaultPromotionRules } from "@/features/results/engine/promotion";
import { canRecalculateResults } from "@/features/results/permissions";
import { recalculateClassTermSchema } from "@/features/results/schemas";
import type {
  GradingBand,
  GradingSchemeInput,
  PromotionRule,
  ResultsEngineSettings,
  ResultEntryStatus,
} from "@/features/results/types";
import { RESULTS_ENGINE_VERSION } from "@/features/results/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatOpsErrorForUser,
  normalizeOpsError,
} from "@/lib/ops/errors";
import { checkRateLimit, RATE_LIMIT_PROFILES } from "@/lib/ops/rate-limit";
import { createCorrelationId, logOpsEvent } from "@/lib/ops/logger";

export type ActionResult =
  | { ok: true; message: string; batchId?: string }
  | { ok: false; error: string };

function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapScheme(scheme: {
  id: string;
  version: number;
  min_score: number | string;
  max_score: number | string;
  decimal_places: number;
  rounding_mode: string;
  grading_scheme_bands: unknown;
}): GradingSchemeInput {
  const bandsRaw = Array.isArray(scheme.grading_scheme_bands)
    ? scheme.grading_scheme_bands
    : [];
  const bands: GradingBand[] = bandsRaw.map(
    (b: {
      minimum_score: number | string;
      maximum_score: number | string;
      grade_code: string;
      grade_label: string;
      grade_point: number | string | null;
      performance_description: string | null;
      is_pass: boolean;
      display_order: number;
    }) => ({
      minimum_score: Number(b.minimum_score),
      maximum_score: Number(b.maximum_score),
      grade_code: b.grade_code,
      grade_label: b.grade_label,
      grade_point: b.grade_point == null ? null : Number(b.grade_point),
      performance_description: b.performance_description,
      is_pass: Boolean(b.is_pass),
      display_order: b.display_order ?? 0,
    }),
  );
  return {
    id: scheme.id,
    version: scheme.version,
    min_score: Number(scheme.min_score),
    max_score: Number(scheme.max_score),
    decimal_places: scheme.decimal_places,
    rounding_mode: scheme.rounding_mode,
    bands,
  };
}

/**
 * Fail closed: only the active school-default scheme is used.
 * Ambiguous “first active row” selection is deliberately rejected.
 */
async function loadGradingScheme(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<GradingSchemeInput | null> {
  const { data: scheme, error } = await supabase
    .from("grading_schemes")
    .select(
      "id, version, min_score, max_score, decimal_places, rounding_mode, grading_scheme_bands(minimum_score, maximum_score, grade_code, grade_label, grade_point, performance_description, is_pass, display_order)",
    )
    .eq("is_active", true)
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!scheme) return null;
  return mapScheme(scheme);
}

function schemeSnapshotJson(scheme: GradingSchemeInput) {
  return {
    id: scheme.id,
    version: scheme.version,
    min_score: scheme.min_score,
    max_score: scheme.max_score,
    decimal_places: scheme.decimal_places,
    rounding_mode: scheme.rounding_mode,
    bands: scheme.bands,
  };
}

function buildSourceFingerprint(
  rows: Array<{
    gradebook_id: string;
    gradebook_revision: number;
    student_id: string;
    entry_status: string;
    marks_obtained: number | null;
    max_marks: number;
  }>,
  scheme: GradingSchemeInput,
  engineVersion: string,
): string {
  const normalized = [...rows]
    .map(
      (r) =>
        `${r.gradebook_id}@${r.gradebook_revision}:${r.student_id}:${r.entry_status}:${r.marks_obtained ?? ""}/${r.max_marks}`,
    )
    .sort();
  const material = [
    engineVersion,
    `scheme:${scheme.id}@${scheme.version}`,
    ...normalized,
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

async function loadSettings(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<ResultsEngineSettings> {
  const { data } = await supabase.rpc("ensure_academic_results_settings");
  const row = unwrapOne<{
    ranking_enabled: boolean;
    ranking_tie_mode: ResultsEngineSettings["ranking_tie_mode"];
    treat_absent_as_zero: boolean;
    include_exempt_in_average: boolean;
    include_not_assessed_in_average: boolean;
  }>(data);
  if (!row) {
    return {
      ranking_enabled: true,
      ranking_tie_mode: "COMPETITION",
      treat_absent_as_zero: false,
      include_exempt_in_average: false,
      include_not_assessed_in_average: false,
    };
  }
  return {
    ranking_enabled: row.ranking_enabled,
    ranking_tie_mode: row.ranking_tie_mode,
    treat_absent_as_zero: row.treat_absent_as_zero,
    include_exempt_in_average: row.include_exempt_in_average,
    include_not_assessed_in_average: row.include_not_assessed_in_average,
  };
}

async function loadPromotionRules(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  academicYearId: string,
  gradeLevelId: string | null,
): Promise<{ rules: PromotionRule[]; policyId: string | null }> {
  const { data: defaultPolicy } = await supabase
    .from("promotion_policies")
    .select(
      "id, promotion_policy_rules(rule_type, outcome, threshold_numeric, threshold_int, priority, label)",
    )
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();

  let yearGradePolicy = null;
  if (gradeLevelId) {
    const { data } = await supabase
      .from("promotion_policies")
      .select(
        "id, promotion_policy_rules(rule_type, outcome, threshold_numeric, threshold_int, priority, label)",
      )
      .eq("is_active", true)
      .eq("academic_year_id", academicYearId)
      .eq("grade_level_id", gradeLevelId)
      .maybeSingle();
    yearGradePolicy = data;
  }

  const chosen = yearGradePolicy ?? defaultPolicy;
  if (!chosen) {
    return { rules: defaultPromotionRules(), policyId: null };
  }

  const rulesRaw = Array.isArray(chosen.promotion_policy_rules)
    ? chosen.promotion_policy_rules
    : [];
  const rules: PromotionRule[] = rulesRaw.map(
    (r: {
      rule_type: PromotionRule["rule_type"];
      outcome: PromotionRule["outcome"];
      threshold_numeric: number | string | null;
      threshold_int: number | null;
      priority: number;
      label: string | null;
    }) => ({
      rule_type: r.rule_type,
      outcome: r.outcome,
      threshold_numeric:
        r.threshold_numeric == null ? null : Number(r.threshold_numeric),
      threshold_int: r.threshold_int,
      priority: r.priority,
      label: r.label,
    }),
  );

  if (rules.length === 0) {
    return { rules: defaultPromotionRules(), policyId: chosen.id };
  }
  return { rules, policyId: chosen.id };
}

/**
 * Recalculate results for one class × term from SUBMITTED/LOCKED gradebooks.
 * Engine computes derived fields; RPC re-validates every source mark before persist.
 */
export async function recalculateClassTermAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canRecalculateResults(current.profile.role)) {
    return { ok: false, error: "Not authorized to recalculate results." };
  }

  const rate = checkRateLimit({
    key: `result-recalc:${current.id}`,
    limit: RATE_LIMIT_PROFILES.resultRecalc.limit,
    windowMs: RATE_LIMIT_PROFILES.resultRecalc.windowMs,
  });
  if (!rate.allowed) {
    const normalized = normalizeOpsError("rate limited", {
      category: "RATE_LIMITED",
    });
    logOpsEvent({
      severity: "warn",
      correlationId: createCorrelationId(),
      action: "recalculate_class_term",
      module: "results",
      outcome: "denied",
      actorId: current.id,
      schoolId: current.profile.school_id ?? undefined,
      errorCategory: "RATE_LIMITED",
    });
    return { ok: false, error: formatOpsErrorForUser(normalized) };
  }

  const parsed = recalculateClassTermSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  let scheme: GradingSchemeInput | null;
  try {
    scheme = await loadGradingScheme(supabase);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to load grading scheme.",
    };
  }
  if (!scheme || scheme.bands.length === 0) {
    return {
      ok: false,
      error:
        "Configure one active default grading scheme with bands before recalculating.",
    };
  }

  const settings = await loadSettings(supabase);
  const gradingSchemeSnapshot = schemeSnapshotJson(scheme);

  const { data: classRow } = await supabase
    .from("classes")
    .select("id, grade_level_id")
    .eq("id", parsed.data.class_id)
    .maybeSingle();
  if (!classRow) return { ok: false, error: "Class not found." };

  const { rules: promotionRules, policyId } = await loadPromotionRules(
    supabase,
    parsed.data.academic_year_id,
    classRow.grade_level_id,
  );

  const { data: gradebooks, error: gbErr } = await supabase
    .from("exam_gradebooks")
    .select(
      "id, exam_id, class_id, status, revision, exams!inner(id, subject_id, assessment_type_id, max_marks, exam_period_id, exam_periods!inner(academic_year_id, term_id))",
    )
    .eq("class_id", parsed.data.class_id)
    .in("status", ["SUBMITTED", "LOCKED"]);

  if (gbErr) return { ok: false, error: gbErr.message };

  const relevant = (gradebooks ?? []).filter((g) => {
    const exam = unwrapOne<{
      id: string;
      subject_id: string;
      assessment_type_id: string | null;
      max_marks: number | string;
      exam_periods: unknown;
    }>(g.exams);
    const period = unwrapOne<{
      academic_year_id: string;
      term_id: string | null;
    }>(exam?.exam_periods);
    return (
      period?.academic_year_id === parsed.data.academic_year_id &&
      period?.term_id === parsed.data.term_id
    );
  });

  if (relevant.length === 0) {
    return {
      ok: false,
      error:
        "No SUBMITTED or LOCKED gradebooks found for this class and term.",
    };
  }

  const missingAssessmentType = relevant.filter((g) => {
    const exam = unwrapOne<{ assessment_type_id: string | null }>(g.exams);
    return !exam?.assessment_type_id;
  });
  if (missingAssessmentType.length > 0) {
    return {
      ok: false,
      error:
        "One or more eligible exams are missing assessment_type_id; cannot weight subject results.",
    };
  }

  const gradebookIds = relevant.map((g) => g.id);
  const { data: resultRows, error: resErr } = await supabase
    .from("exam_assessment_results")
    .select(
      "gradebook_id, student_id, entry_status, marks_obtained, max_marks_snapshot",
    )
    .in("gradebook_id", gradebookIds);

  if (resErr) return { ok: false, error: resErr.message };

  const gbMeta = new Map(
    relevant.map((g) => {
      const exam = unwrapOne<{
        id: string;
        subject_id: string;
        assessment_type_id: string | null;
        max_marks: number | string;
      }>(g.exams)!;
      return [
        g.id,
        {
          exam_id: exam.id,
          subject_id: exam.subject_id,
          assessment_type_id: exam.assessment_type_id as string,
          gradebook_id: g.id,
          gradebook_revision: Number(g.revision ?? 1),
        },
      ] as const;
    }),
  );

  const { data: weightScheme } = await supabase
    .from("assessment_weight_schemes")
    .select(
      "id, version, name, assessment_weight_items(assessment_type_id, weight_percentage)",
    )
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();

  const defaultWeights =
    weightScheme && Array.isArray(weightScheme.assessment_weight_items)
      ? weightScheme.assessment_weight_items.map(
          (i: {
            assessment_type_id: string;
            weight_percentage: number | string;
          }) => ({
            assessment_type_id: i.assessment_type_id,
            weight_percentage: Number(i.weight_percentage),
          }),
        )
      : null;

  const weightSchemeSnapshot = weightScheme
    ? {
        id: weightScheme.id,
        version: weightScheme.version ?? null,
        name: weightScheme.name ?? null,
        items: defaultWeights ?? [],
      }
    : null;

  type MarkRow = {
    student_id: string;
    subject_id: string;
    assessment_type_id: string;
    exam_id: string;
    gradebook_id: string;
    gradebook_revision: number;
    raw: {
      student_id: string;
      entry_status: ResultEntryStatus;
      marks_obtained: number | null;
      max_marks: number;
    };
  };

  const examMarks: MarkRow[] = [];
  for (const row of resultRows ?? []) {
    const meta = gbMeta.get(row.gradebook_id);
    if (!meta) {
      return {
        ok: false,
        error: "Gradebook metadata missing for an assessment result row.",
      };
    }
    examMarks.push({
      student_id: row.student_id,
      subject_id: meta.subject_id,
      assessment_type_id: meta.assessment_type_id,
      exam_id: meta.exam_id,
      gradebook_id: meta.gradebook_id,
      gradebook_revision: meta.gradebook_revision,
      raw: {
        student_id: row.student_id,
        entry_status: row.entry_status as ResultEntryStatus,
        marks_obtained: toNumber(row.marks_obtained),
        max_marks: Number(row.max_marks_snapshot),
      },
    });
  }

  const subjectIds = [...new Set(examMarks.map((m) => m.subject_id))];
  const weightsBySubject: Record<string, typeof defaultWeights> = {};
  for (const sid of subjectIds) {
    weightsBySubject[sid] = defaultWeights;
  }

  let computed;
  try {
    computed = recalculateClassTerm({
      scheme,
      settings,
      promotionRules,
      isTerminalGrade: false,
      examMarks,
      weightsBySubject,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Results calculation failed.",
    };
  }

  const fingerprintRows = examMarks.map((m) => ({
    gradebook_id: m.gradebook_id,
    gradebook_revision: m.gradebook_revision,
    student_id: m.student_id,
    entry_status: m.raw.entry_status,
    marks_obtained: m.raw.marks_obtained,
    max_marks: m.raw.max_marks,
  }));
  const sourceFingerprint = buildSourceFingerprint(
    fingerprintRows,
    scheme,
    RESULTS_ENGINE_VERSION,
  );

  const batchId = randomUUID();

  const examPayload = examMarks.map((mark, index) => {
    const er = computed.exam_results[index];
    return {
      subject_id: mark.subject_id,
      exam_id: mark.exam_id,
      gradebook_id: mark.gradebook_id,
      gradebook_revision: mark.gradebook_revision,
      assessment_type_id: mark.assessment_type_id,
      student_id: mark.student_id,
      entry_status: er.entry_status,
      marks_obtained: er.marks_obtained,
      max_marks: er.max_marks,
      percentage: er.percentage,
      grade_code: er.grade_code,
      grade_label: er.grade_label,
      grade_point: er.grade_point,
      is_pass: er.is_pass,
      remark: er.remark,
      grading_scheme_id: er.grading_scheme_id,
      grading_scheme_version: er.grading_scheme_version,
      grading_scheme_snapshot: gradingSchemeSnapshot,
      engine_version: RESULTS_ENGINE_VERSION,
      source_fingerprint: sourceFingerprint,
    };
  });

  const subjectPayload = computed.subject_results.map((s) => ({
    subject_id: s.subject_id,
    student_id: s.student_id,
    weighted_percentage: s.weighted_percentage,
    grade_code: s.grade_code,
    grade_label: s.grade_label,
    grade_point: s.grade_point,
    is_pass: s.is_pass,
    remark: s.remark,
    subject_position: s.subject_position,
    tied_count: s.tied_count,
    components: s.components,
    weight_scheme_id: weightScheme?.id ?? null,
    weight_scheme_snapshot: weightSchemeSnapshot,
    grading_scheme_id: scheme.id,
    grading_scheme_version: scheme.version,
    grading_scheme_snapshot: gradingSchemeSnapshot,
    engine_version: RESULTS_ENGINE_VERSION,
    source_fingerprint: sourceFingerprint,
  }));

  const termPayload = computed.term_results.map((t) => ({
    student_id: t.student_id,
    subject_count: t.subject_count,
    scored_subject_count: t.scored_subject_count,
    passed_subject_count: t.passed_subject_count,
    failed_subject_count: t.failed_subject_count,
    average_percentage: t.average_percentage,
    grade_code: t.grade_code,
    grade_label: t.grade_label,
    grade_point: t.grade_point,
    is_pass: t.is_pass,
    remark: t.remark,
    overall_position: t.overall_position,
    tied_count: t.tied_count,
    promotion_outcome: t.promotion_outcome,
    promotion_reason: t.promotion_reason,
    grading_scheme_id: scheme.id,
    grading_scheme_version: scheme.version,
    grading_scheme_snapshot: gradingSchemeSnapshot,
    promotion_policy_id: policyId,
    engine_version: RESULTS_ENGINE_VERSION,
    source_fingerprint: sourceFingerprint,
  }));

  const statisticPayload = [
    {
      scope: "CLASS_TERM",
      subject_id: null,
      stats: computed.class_statistics,
      engine_version: RESULTS_ENGINE_VERSION,
      source_fingerprint: sourceFingerprint,
    },
    ...Object.entries(computed.subject_statistics).map(
      ([subject_id, stats]) => ({
        scope: "CLASS_SUBJECT_TERM",
        subject_id,
        stats,
        engine_version: RESULTS_ENGINE_VERSION,
        source_fingerprint: sourceFingerprint,
      }),
    ),
  ];

  const { data, error } = await supabase.rpc(
    "replace_class_term_result_snapshots",
    {
      p_academic_year_id: parsed.data.academic_year_id,
      p_term_id: parsed.data.term_id,
      p_class_id: parsed.data.class_id,
      p_batch_id: batchId,
      p_engine_version: RESULTS_ENGINE_VERSION,
      p_source_fingerprint: sourceFingerprint,
      p_exam_rows: examPayload,
      p_subject_rows: subjectPayload,
      p_term_rows: termPayload,
      p_statistic_rows: statisticPayload,
    },
  );

  if (error) {
    const msg = error.message ?? "Recalculation failed.";
    if (/concurrent|lock|stale|mismatch|does not match|fingerprint/i.test(msg)) {
      return {
        ok: false,
        error:
          "Marks changed while calculating, or another calculation is already running. Refresh the page and calculate again.",
      };
    }
    return { ok: false, error: msg };
  }

  revalidatePath("/dashboard/results");
  revalidatePath("/dashboard/results", "layout");
  return {
    ok: true,
    message: `Recalculated ${termPayload.length} student term results.`,
    batchId: (data as { batch_id?: string } | null)?.batch_id ?? batchId,
  };
}
