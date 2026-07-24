"use server";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canOpenResults,
  canRecalculateResults,
  canViewAllResults,
} from "@/features/results/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StatisticsSummary } from "@/features/results/types";
import { RESULTS_ENGINE_VERSION } from "@/features/results/types";

export type ResultsHubContext = {
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
  terms: Array<{
    id: string;
    name: string;
    academic_year_id: string;
    is_current: boolean;
  }>;
  classes: Array<{ id: string; name: string; grade_name: string }>;
  subjects: Array<{ id: string; name: string }>;
  activeYearId: string | null;
  activeTermId: string | null;
  viewAll: boolean;
  canRecalculate: boolean;
};

export type TermResultRow = {
  id: string;
  student_id: string;
  student_name: string;
  admission_number: string | null;
  average_percentage: number | null;
  grade_code: string | null;
  grade_label: string | null;
  overall_position: number | null;
  promotion_outcome: string;
  promotion_reason: string | null;
  passed_subject_count: number;
  failed_subject_count: number;
  remark: string | null;
};

export type SubjectResultRow = {
  id: string;
  student_id: string;
  student_name: string;
  subject_id: string;
  subject_name: string;
  weighted_percentage: number | null;
  grade_code: string | null;
  subject_position: number | null;
  is_pass: boolean | null;
  remark: string | null;
};

export type ClassResultsBundle = {
  termResults: TermResultRow[];
  subjectResults: SubjectResultRow[];
  classStatistics: StatisticsSummary | null;
  computedAt: string | null;
  batchId: string | null;
  engineVersion: string | null;
  sourceFingerprint: string | null;
  /** True when any term snapshot in this class×term is marked stale. */
  isStale: boolean;
};

function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

export async function getResultsHubContext(): Promise<ResultsHubContext | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenResults(current.profile.role)) return null;

  const supabase = await createSupabaseServerClient();
  const [{ data: years }, { data: terms }, { data: classes }, { data: subjects }] =
    await Promise.all([
      supabase
        .from("academic_years")
        .select("id, name, is_current")
        .order("start_date", { ascending: false }),
      supabase
        .from("terms")
        .select("id, name, academic_year_id, is_current")
        .order("term_number", { ascending: true }),
      supabase
        .from("classes")
        .select("id, name, grade_levels(name)")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("subjects")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);

  const activeYear =
    years?.find((y) => y.is_current) ?? years?.[0] ?? null;
  const activeTerm =
    terms?.find(
      (t) => t.is_current && t.academic_year_id === activeYear?.id,
    ) ??
    terms?.find((t) => t.academic_year_id === activeYear?.id) ??
    null;

  return {
    academicYears: (years ?? []).map((y) => ({
      id: y.id,
      name: y.name,
      is_current: Boolean(y.is_current),
    })),
    terms: (terms ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      academic_year_id: t.academic_year_id,
      is_current: Boolean(t.is_current),
    })),
    classes: (classes ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      grade_name:
        unwrapOne<{ name: string }>(c.grade_levels)?.name ?? "Grade",
    })),
    subjects: (subjects ?? []).map((s) => ({ id: s.id, name: s.name })),
    activeYearId: activeYear?.id ?? null,
    activeTermId: activeTerm?.id ?? null,
    viewAll: canViewAllResults(current.profile.role),
    canRecalculate: canRecalculateResults(current.profile.role),
  };
}

export async function getClassTermResults(args: {
  academicYearId: string;
  termId: string;
  classId: string;
  subjectId?: string | null;
}): Promise<ClassResultsBundle | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenResults(current.profile.role)) return null;

  const supabase = await createSupabaseServerClient();

  const termQuery = supabase
    .from("student_term_result_snapshots")
    .select(
      "id, student_id, average_percentage, grade_code, grade_label, overall_position, promotion_outcome, promotion_reason, passed_subject_count, failed_subject_count, remark, computed_at, computation_batch_id, engine_version, source_fingerprint, is_stale, students(first_name, last_name, admission_number)",
    )
    .eq("academic_year_id", args.academicYearId)
    .eq("term_id", args.termId)
    .eq("class_id", args.classId)
    .order("overall_position", { ascending: true, nullsFirst: false });

  const { data: termRows, error: termErr } = await termQuery;
  if (termErr) throw new Error(termErr.message);

  let subjectQuery = supabase
    .from("student_subject_result_snapshots")
    .select(
      "id, student_id, subject_id, weighted_percentage, grade_code, subject_position, is_pass, remark, students(first_name, last_name), subjects(name)",
    )
    .eq("academic_year_id", args.academicYearId)
    .eq("term_id", args.termId)
    .eq("class_id", args.classId);

  if (args.subjectId) {
    subjectQuery = subjectQuery.eq("subject_id", args.subjectId);
  }

  const { data: subjectRows, error: subjectErr } = await subjectQuery;
  if (subjectErr) throw new Error(subjectErr.message);

  const { data: statsRows } = await supabase
    .from("result_statistic_snapshots")
    .select("stats, scope, subject_id, computed_at, computation_batch_id")
    .eq("academic_year_id", args.academicYearId)
    .eq("term_id", args.termId)
    .eq("class_id", args.classId)
    .eq("scope", "CLASS_TERM")
    .maybeSingle();

  const termResults: TermResultRow[] = (termRows ?? []).map((row) => {
    const student = unwrapOne<{
      first_name: string;
      last_name: string;
      admission_number: string | null;
    }>(row.students);
    return {
      id: row.id,
      student_id: row.student_id,
      student_name: student
        ? `${student.last_name}, ${student.first_name}`
        : "Student",
      admission_number: student?.admission_number ?? null,
      average_percentage:
        row.average_percentage == null ? null : Number(row.average_percentage),
      grade_code: row.grade_code,
      grade_label: row.grade_label,
      overall_position:
        row.overall_position == null ? null : Number(row.overall_position),
      promotion_outcome: row.promotion_outcome,
      promotion_reason: row.promotion_reason,
      passed_subject_count: row.passed_subject_count,
      failed_subject_count: row.failed_subject_count,
      remark: row.remark,
    };
  });

  const subjectResults: SubjectResultRow[] = (subjectRows ?? []).map((row) => {
    const student = unwrapOne<{ first_name: string; last_name: string }>(
      row.students,
    );
    const subject = unwrapOne<{ name: string }>(row.subjects);
    return {
      id: row.id,
      student_id: row.student_id,
      student_name: student
        ? `${student.last_name}, ${student.first_name}`
        : "Student",
      subject_id: row.subject_id,
      subject_name: subject?.name ?? "Subject",
      weighted_percentage:
        row.weighted_percentage == null
          ? null
          : Number(row.weighted_percentage),
      grade_code: row.grade_code,
      subject_position:
        row.subject_position == null ? null : Number(row.subject_position),
      is_pass: row.is_pass,
      remark: row.remark,
    };
  });

  let isStale = (termRows ?? []).some((row) => Boolean(row.is_stale));
  const engineVersion = termRows?.[0]?.engine_version ?? null;
  if (
    engineVersion != null &&
    engineVersion !== RESULTS_ENGINE_VERSION
  ) {
    isStale = true;
  }

  // Live stale detection: gradebook revision/status drift since snapshot.
  if (!isStale && (termRows?.length ?? 0) > 0) {
    const { data: examSnaps } = await supabase
      .from("student_exam_result_snapshots")
      .select("gradebook_id, gradebook_revision")
      .eq("academic_year_id", args.academicYearId)
      .eq("term_id", args.termId)
      .eq("class_id", args.classId);

    const gradebookIds = [
      ...new Set((examSnaps ?? []).map((e) => e.gradebook_id).filter(Boolean)),
    ];
    if (gradebookIds.length > 0) {
      const { data: liveBooks } = await supabase
        .from("exam_gradebooks")
        .select("id, revision, status")
        .in("id", gradebookIds);
      const byId = new Map((liveBooks ?? []).map((g) => [g.id, g]));
      for (const snap of examSnaps ?? []) {
        const live = byId.get(snap.gradebook_id);
        if (
          !live ||
          !["SUBMITTED", "LOCKED"].includes(String(live.status)) ||
          Number(live.revision) !== Number(snap.gradebook_revision)
        ) {
          isStale = true;
          break;
        }
      }
    }
  }

  return {
    termResults,
    subjectResults,
    classStatistics: (statsRows?.stats as StatisticsSummary | null) ?? null,
    computedAt: statsRows?.computed_at ?? termRows?.[0]?.computed_at ?? null,
    batchId:
      statsRows?.computation_batch_id ??
      termRows?.[0]?.computation_batch_id ??
      null,
    engineVersion,
    sourceFingerprint: termRows?.[0]?.source_fingerprint ?? null,
    isStale,
  };
}

export async function getStudentTermResultDetail(args: {
  academicYearId: string;
  termId: string;
  classId: string;
  studentId: string;
}): Promise<{
  term: TermResultRow | null;
  subjects: SubjectResultRow[];
  isStale: boolean;
  exams: Array<{
    exam_id: string;
    subject_name: string;
    percentage: number | null;
    grade_code: string | null;
    entry_status: string;
    marks_obtained: number | null;
    max_marks: number;
  }>;
} | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenResults(current.profile.role)) return null;

  const bundle = await getClassTermResults({
    academicYearId: args.academicYearId,
    termId: args.termId,
    classId: args.classId,
  });
  if (!bundle) return null;

  const supabase = await createSupabaseServerClient();
  const { data: exams } = await supabase
    .from("student_exam_result_snapshots")
    .select(
      "exam_id, percentage, grade_code, entry_status, marks_obtained, max_marks, subjects(name)",
    )
    .eq("academic_year_id", args.academicYearId)
    .eq("term_id", args.termId)
    .eq("class_id", args.classId)
    .eq("student_id", args.studentId);

  return {
    term:
      bundle.termResults.find((t) => t.student_id === args.studentId) ?? null,
    subjects: bundle.subjectResults.filter(
      (s) => s.student_id === args.studentId,
    ),
    isStale: bundle.isStale,
    exams: (exams ?? []).map((e) => ({
      exam_id: e.exam_id,
      subject_name: unwrapOne<{ name: string }>(e.subjects)?.name ?? "Subject",
      percentage: e.percentage == null ? null : Number(e.percentage),
      grade_code: e.grade_code,
      entry_status: e.entry_status,
      marks_obtained:
        e.marks_obtained == null ? null : Number(e.marks_obtained),
      max_marks: Number(e.max_marks),
    })),
  };
}
