"use server";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canApproveReportCards,
  canEditReportCardRemarks,
  canManageReportCardSettings,
  canOpenReportCards,
  canPrintReportCards,
  canPublishReportCards,
  canReviewReportCards,
} from "@/features/report-cards/permissions";
import {
  buildAttendanceSnapshot,
  defaultReportCardSettings,
  emptyAttendanceSnapshot,
} from "@/features/report-cards/snapshot";
import type {
  AttendanceSnapshot,
  ReportCardRenderPayload,
  ReportCardSettings,
  ReportCardStatus,
} from "@/features/report-cards/types";
import { RESULTS_ENGINE_VERSION } from "@/features/results/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ReportCardsHubContext = {
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
  terms: Array<{
    id: string;
    name: string;
    academic_year_id: string;
    is_current: boolean;
    start_date: string | null;
    end_date: string | null;
  }>;
  classes: Array<{ id: string; name: string; grade_name: string }>;
  activeYearId: string | null;
  activeTermId: string | null;
  canApprove: boolean;
  canPublish: boolean;
  canReview: boolean;
  canEditRemarks: boolean;
  canPrint: boolean;
  canManageSettings: boolean;
  settings: ReportCardSettings;
};

export type ClassReadiness = {
  eligibleStudents: number;
  resultsReady: number;
  resultsStale: number;
  missingResults: number;
  drafts: number;
  reviewed: number;
  approved: number;
  published: number;
  unpublished: number;
  voided: number;
  outdated: number;
  coherentBatchId: string | null;
  coherentFingerprint: string | null;
  classIsStale: boolean;
};

export type ReportCardListItem = {
  id: string;
  student_id: string;
  student_name: string;
  admission_number: string | null;
  status: ReportCardStatus;
  revision: number;
  source_is_outdated: boolean;
  source_fingerprint: string;
  teacher_remark: string | null;
  headteacher_remark: string | null;
  updated_at: string;
  has_render_payload: boolean;
};

function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

function mapSettings(row: Record<string, unknown> | null): ReportCardSettings {
  const defaults = defaultReportCardSettings();
  if (!row) return defaults;
  return {
    title: String(row.title ?? defaults.title),
    show_school_logo: Boolean(row.show_school_logo ?? true),
    show_admission_number: Boolean(row.show_admission_number ?? true),
    show_class_position: Boolean(row.show_class_position ?? true),
    show_subject_position: Boolean(row.show_subject_position ?? false),
    show_grade_points: Boolean(row.show_grade_points ?? true),
    show_promotion_recommendation: Boolean(
      row.show_promotion_recommendation ?? true,
    ),
    show_attendance: Boolean(row.show_attendance ?? true),
    show_teacher_remark: Boolean(row.show_teacher_remark ?? true),
    show_headteacher_remark: Boolean(row.show_headteacher_remark ?? true),
    show_grading_key: Boolean(row.show_grading_key ?? true),
    show_generated_timestamp: Boolean(row.show_generated_timestamp ?? true),
    require_teacher_remark_for_review: Boolean(
      row.require_teacher_remark_for_review ?? false,
    ),
    require_headteacher_remark_for_approve: Boolean(
      row.require_headteacher_remark_for_approve ?? true,
    ),
    footer_text:
      row.footer_text == null ? null : String(row.footer_text),
    ranking_disabled_message: String(
      row.ranking_disabled_message ?? defaults.ranking_disabled_message,
    ),
    template_version: String(row.template_version ?? defaults.template_version),
  };
}

export async function getReportCardsHubContext(): Promise<ReportCardsHubContext | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenReportCards(current.profile.role)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: years }, { data: terms }, { data: classes }] =
    await Promise.all([
      supabase
        .from("academic_years")
        .select("id, name, is_current")
        .order("start_date", { ascending: false }),
      supabase
        .from("terms")
        .select(
          "id, name, academic_year_id, is_current, start_date, end_date",
        )
        .order("term_number", { ascending: true }),
      supabase
        .from("classes")
        .select("id, name, grade_levels(name)")
        .eq("is_active", true)
        .order("name"),
    ]);

  let settings = defaultReportCardSettings();
  const { data: settingsRpc } = await supabase.rpc("ensure_report_card_settings");
  if (settingsRpc) {
    settings = mapSettings(
      (Array.isArray(settingsRpc) ? settingsRpc[0] : settingsRpc) as Record<
        string,
        unknown
      >,
    );
  }

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
      start_date: t.start_date ?? null,
      end_date: t.end_date ?? null,
    })),
    classes: (classes ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      grade_name: unwrapOne<{ name: string }>(c.grade_levels)?.name ?? "Grade",
    })),
    activeYearId: activeYear?.id ?? null,
    activeTermId: activeTerm?.id ?? null,
    canApprove: canApproveReportCards(current.profile.role),
    canPublish: canPublishReportCards(current.profile.role),
    canReview: canReviewReportCards(current.profile.role),
    canEditRemarks: canEditReportCardRemarks(current.profile.role),
    canPrint: canPrintReportCards(current.profile.role),
    canManageSettings: canManageReportCardSettings(current.profile.role),
    settings,
  };
}

export async function getClassReportCardReadiness(args: {
  academicYearId: string;
  termId: string;
  classId: string;
}): Promise<ClassReadiness | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenReportCards(current.profile.role)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const { data: enrolments } = await supabase
    .from("student_class_enrollments")
    .select("student_id, students!inner(id, status, is_archived)")
    .eq("class_id", args.classId)
    .eq("is_current", true);

  const eligible = (enrolments ?? []).filter((row) => {
    const student = unwrapOne<{ status: string; is_archived?: boolean }>(
      row.students,
    );
    return student && student.status === "active" && !student.is_archived;
  });

  const { data: termRows } = await supabase
    .from("student_term_result_snapshots")
    .select(
      "id, student_id, source_fingerprint, computation_batch_id, engine_version, is_stale, computed_at",
    )
    .eq("academic_year_id", args.academicYearId)
    .eq("term_id", args.termId)
    .eq("class_id", args.classId);

  const { data: cards } = await supabase
    .from("student_report_cards")
    .select("id, student_id, status, source_is_outdated, source_fingerprint")
    .eq("academic_year_id", args.academicYearId)
    .eq("term_id", args.termId)
    .eq("class_id", args.classId);

  // Live stale detection via gradebook revision drift (same idea as Results).
  let classIsStale = (termRows ?? []).some((r) => Boolean(r.is_stale));
  if (!classIsStale && (termRows?.length ?? 0) > 0) {
    const engineMismatch = (termRows ?? []).some(
      (r) => r.engine_version !== RESULTS_ENGINE_VERSION,
    );
    if (engineMismatch) classIsStale = true;

    const { data: examSnaps } = await supabase
      .from("student_exam_result_snapshots")
      .select("gradebook_id, gradebook_revision")
      .eq("academic_year_id", args.academicYearId)
      .eq("term_id", args.termId)
      .eq("class_id", args.classId);
    const gbIds = [
      ...new Set((examSnaps ?? []).map((e) => e.gradebook_id).filter(Boolean)),
    ];
    if (gbIds.length > 0) {
      const { data: liveBooks } = await supabase
        .from("exam_gradebooks")
        .select("id, revision, status")
        .in("id", gbIds);
      const byId = new Map((liveBooks ?? []).map((g) => [g.id, g]));
      for (const snap of examSnaps ?? []) {
        const live = byId.get(snap.gradebook_id);
        if (
          !live ||
          !["SUBMITTED", "LOCKED"].includes(String(live.status)) ||
          Number(live.revision) !== Number(snap.gradebook_revision)
        ) {
          classIsStale = true;
          break;
        }
      }
    }
  }

  const resultStudentIds = new Set((termRows ?? []).map((r) => r.student_id));
  const eligibleIds = new Set(eligible.map((e) => e.student_id));
  const fingerprints = new Set(
    (termRows ?? []).map((r) => r.source_fingerprint),
  );
  const batches = new Set(
    (termRows ?? []).map((r) => r.computation_batch_id),
  );

  const statusCount = (status: string) =>
    (cards ?? []).filter((c) => c.status === status).length;

  return {
    eligibleStudents: eligibleIds.size,
    resultsReady: [...eligibleIds].filter((id) => resultStudentIds.has(id))
      .length,
    resultsStale: classIsStale ? resultStudentIds.size : 0,
    missingResults: [...eligibleIds].filter((id) => !resultStudentIds.has(id))
      .length,
    drafts: statusCount("DRAFT"),
    reviewed: statusCount("REVIEWED"),
    approved: statusCount("APPROVED"),
    published: statusCount("PUBLISHED"),
    unpublished: statusCount("UNPUBLISHED"),
    voided: statusCount("VOIDED"),
    outdated: (cards ?? []).filter((c) => {
      if (c.source_is_outdated) return true;
      const live = (termRows ?? []).find((t) => t.student_id === c.student_id);
      if (!live) return true;
      return (
        Boolean(live.is_stale) ||
        live.source_fingerprint !== c.source_fingerprint
      );
    }).length,
    coherentBatchId: batches.size === 1 ? [...batches][0] : null,
    coherentFingerprint:
      fingerprints.size === 1 ? [...fingerprints][0] : null,
    classIsStale,
  };
}

export async function listClassReportCards(args: {
  academicYearId: string;
  termId: string;
  classId: string;
}): Promise<ReportCardListItem[] | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenReportCards(current.profile.role)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: termRows }] = await Promise.all([
    supabase
      .from("student_report_cards")
      .select(
        "id, student_id, status, revision, source_is_outdated, source_fingerprint, teacher_remark, headteacher_remark, updated_at, render_payload, students(first_name, last_name, admission_number)",
      )
      .eq("academic_year_id", args.academicYearId)
      .eq("term_id", args.termId)
      .eq("class_id", args.classId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("student_term_result_snapshots")
      .select("student_id, source_fingerprint, is_stale")
      .eq("academic_year_id", args.academicYearId)
      .eq("term_id", args.termId)
      .eq("class_id", args.classId),
  ]);

  if (error) throw new Error(error.message);

  const liveByStudent = new Map(
    (termRows ?? []).map((r) => [
      r.student_id,
      {
        fingerprint: r.source_fingerprint as string,
        is_stale: Boolean(r.is_stale),
      },
    ]),
  );

  return (data ?? []).map((row) => {
    const student = unwrapOne<{
      first_name: string;
      last_name: string;
      admission_number: string | null;
    }>(row.students);
    const live = liveByStudent.get(row.student_id);
    const outdated =
      Boolean(row.source_is_outdated) ||
      !live ||
      live.is_stale ||
      live.fingerprint !== row.source_fingerprint;
    return {
      id: row.id,
      student_id: row.student_id,
      student_name: student
        ? `${student.last_name}, ${student.first_name}`
        : "Student",
      admission_number: student?.admission_number ?? null,
      status: row.status as ReportCardStatus,
      revision: row.revision,
      source_is_outdated: outdated,
      source_fingerprint: row.source_fingerprint,
      teacher_remark: row.teacher_remark,
      headteacher_remark: row.headteacher_remark,
      updated_at: row.updated_at,
      has_render_payload: row.render_payload != null,
    };
  });
}

export async function getReportCardDetail(
  reportCardId: string,
): Promise<{
  card: ReportCardListItem & {
    academic_year_id: string;
    term_id: string;
    class_id: string;
    engine_version: string;
    computation_batch_id: string;
    attendance_snapshot: AttendanceSnapshot;
    render_payload: ReportCardRenderPayload | null;
    void_reason: string | null;
    approved_at: string | null;
    published_at: string | null;
  };
  events: Array<{
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    reason: string | null;
    created_at: string;
  }>;
} | null> {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenReportCards(current.profile.role)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("student_report_cards")
    .select(
      "id, student_id, academic_year_id, term_id, class_id, status, revision, source_is_outdated, source_fingerprint, engine_version, computation_batch_id, teacher_remark, headteacher_remark, updated_at, attendance_snapshot, render_payload, void_reason, approved_at, published_at, students(first_name, last_name, admission_number)",
    )
    .eq("id", reportCardId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) return null;

  const { data: liveTerm } = await supabase
    .from("student_term_result_snapshots")
    .select("source_fingerprint, is_stale")
    .eq("academic_year_id", row.academic_year_id)
    .eq("term_id", row.term_id)
    .eq("class_id", row.class_id)
    .eq("student_id", row.student_id)
    .maybeSingle();

  const sourceIsOutdated =
    Boolean(row.source_is_outdated) ||
    !liveTerm ||
    Boolean(liveTerm.is_stale) ||
    liveTerm.source_fingerprint !== row.source_fingerprint;

  const { data: events } = await supabase
    .from("report_card_events")
    .select("id, event_type, from_status, to_status, reason, created_at")
    .eq("report_card_id", reportCardId)
    .order("created_at", { ascending: false })
    .limit(50);

  const student = unwrapOne<{
    first_name: string;
    last_name: string;
    admission_number: string | null;
  }>(row.students);

  return {
    card: {
      id: row.id,
      student_id: row.student_id,
      student_name: student
        ? `${student.last_name}, ${student.first_name}`
        : "Student",
      admission_number: student?.admission_number ?? null,
      status: row.status as ReportCardStatus,
      revision: row.revision,
      source_is_outdated: sourceIsOutdated,
      source_fingerprint: row.source_fingerprint,
      teacher_remark: row.teacher_remark,
      headteacher_remark: row.headteacher_remark,
      updated_at: row.updated_at,
      has_render_payload: row.render_payload != null,
      academic_year_id: row.academic_year_id,
      term_id: row.term_id,
      class_id: row.class_id,
      engine_version: row.engine_version,
      computation_batch_id: row.computation_batch_id,
      attendance_snapshot: (row.attendance_snapshot as AttendanceSnapshot) ??
        emptyAttendanceSnapshot(null, null, "Not available"),
      render_payload: (row.render_payload as ReportCardRenderPayload | null) ??
        null,
      void_reason: row.void_reason,
      approved_at: row.approved_at,
      published_at: row.published_at,
    },
    events: (events ?? []).map((e) => ({
      id: e.id,
      event_type: e.event_type,
      from_status: e.from_status,
      to_status: e.to_status,
      reason: e.reason,
      created_at: e.created_at,
    })),
  };
}

export async function loadTermAttendanceForStudent(args: {
  studentId: string;
  classId: string;
  termStart: string | null;
  termEnd: string | null;
}): Promise<AttendanceSnapshot> {
  if (!args.termStart || !args.termEnd) {
    return emptyAttendanceSnapshot(null, null, "Term dates are not configured.");
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("student_id", args.studentId)
    .eq("class_id", args.classId)
    .gte("attendance_date", args.termStart)
    .lte("attendance_date", args.termEnd);

  return buildAttendanceSnapshot({
    termStart: args.termStart,
    termEnd: args.termEnd,
    statuses: (data ?? []).map((r) => String(r.status)),
  });
}
