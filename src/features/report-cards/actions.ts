"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canApproveReportCards,
  canEditReportCardRemarks,
  canManageReportCardSettings,
  canOpenReportCards,
  canPublishReportCards,
  canReviewReportCards,
} from "@/features/report-cards/permissions";
import { loadTermAttendanceForStudent } from "@/features/report-cards/queries";
import {
  generateClassDraftsSchema,
  reportCardIdRevisionSchema,
  saveRemarksSchema,
  unpublishReportCardSchema,
  updateReportCardSettingsSchema,
  voidReportCardSchema,
} from "@/features/report-cards/schemas";
import {
  checksumRenderPayload,
  defaultReportCardSettings,
  mapSubjectRows,
  sanitizePlainRemark,
} from "@/features/report-cards/snapshot";
import type {
  ReportCardRenderPayload,
  ReportCardSettings,
} from "@/features/report-cards/types";
import { REPORT_CARD_TEMPLATE_VERSION } from "@/features/report-cards/types";
import { RESULTS_ENGINE_VERSION } from "@/features/results/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionResult =
  | { ok: true; message: string; details?: Record<string, number> }
  | { ok: false; error: string; details?: Record<string, number> };

function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

function mapSettings(row: Record<string, unknown> | null): ReportCardSettings {
  const defaults = defaultReportCardSettings();
  if (!row) return defaults;
  return {
    ...defaults,
    ...Object.fromEntries(
      Object.keys(defaults).map((k) => [
        k,
        row[k] === undefined ? defaults[k as keyof ReportCardSettings] : row[k],
      ]),
    ),
  } as ReportCardSettings;
}

function normalizeActionError(message: string): string {
  const msg = message || "Request failed.";
  if (/revision conflict/i.test(msg)) {
    return "Revision conflict. Refresh the page and try again.";
  }
  if (/stale|outdated|fingerprint|recalculate/i.test(msg)) {
    return "Results are missing, stale, or changed. Recalculate Results, then regenerate report cards.";
  }
  if (/not authorized|permission/i.test(msg)) {
    return "You are not authorized for this action.";
  }
  if (/remark is required/i.test(msg)) {
    return msg;
  }
  if (/void reason/i.test(msg)) {
    return "A void reason is required.";
  }
  return msg.length > 180 ? "Unexpected server error." : msg;
}

async function loadSettings(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<ReportCardSettings> {
  const { data } = await supabase.rpc("ensure_report_card_settings");
  return mapSettings(
    (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null,
  );
}

/**
 * Generate or refresh DRAFT report cards for every student with a Phase 2D.1
 * term snapshot in the class×term. Does not invent academic values.
 */
export async function generateClassReportCardDraftsAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canOpenReportCards(current.profile.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const parsed = generateClassDraftsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const settings = await loadSettings(supabase);

  const { data: termMeta } = await supabase
    .from("terms")
    .select("id, start_date, end_date, name, academic_year_id")
    .eq("id", parsed.data.term_id)
    .maybeSingle();
  if (!termMeta || termMeta.academic_year_id !== parsed.data.academic_year_id) {
    return { ok: false, error: "Term not found for academic year." };
  }

  const { data: termRows, error: termErr } = await supabase
    .from("student_term_result_snapshots")
    .select(
      "id, student_id, source_fingerprint, engine_version, computation_batch_id, is_stale",
    )
    .eq("academic_year_id", parsed.data.academic_year_id)
    .eq("term_id", parsed.data.term_id)
    .eq("class_id", parsed.data.class_id);

  if (termErr) return { ok: false, error: normalizeActionError(termErr.message) };
  if (!termRows?.length) {
    return {
      ok: false,
      error: "Results missing. Recalculate results before generating report cards.",
    };
  }

  if (termRows.some((r) => r.is_stale)) {
    return {
      ok: false,
      error: "Results are stale. Recalculate results before generating report cards.",
    };
  }

  const fingerprints = new Set(termRows.map((r) => r.source_fingerprint));
  const batches = new Set(termRows.map((r) => r.computation_batch_id));
  if (fingerprints.size !== 1 || batches.size !== 1) {
    return {
      ok: false,
      error:
        "Class results span multiple calculation runs. Recalculate the class term once, then generate.",
    };
  }

  // Gradebook drift check
  const { data: examSnaps } = await supabase
    .from("student_exam_result_snapshots")
    .select("gradebook_id, gradebook_revision")
    .eq("academic_year_id", parsed.data.academic_year_id)
    .eq("term_id", parsed.data.term_id)
    .eq("class_id", parsed.data.class_id);
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
        return {
          ok: false,
          error:
            "Source gradebooks changed or were reopened. Recalculate results before generating report cards.",
        };
      }
    }
  }

  let created = 0;
  let failed = 0;
  for (const row of termRows) {
    if (row.engine_version !== RESULTS_ENGINE_VERSION) {
      failed += 1;
      continue;
    }
    const attendance = await loadTermAttendanceForStudent({
      studentId: row.student_id,
      classId: parsed.data.class_id,
      termStart: termMeta.start_date,
      termEnd: termMeta.end_date,
    });

    const { error } = await supabase.rpc("generate_or_refresh_report_card_draft", {
      p_academic_year_id: parsed.data.academic_year_id,
      p_term_id: parsed.data.term_id,
      p_class_id: parsed.data.class_id,
      p_student_id: row.student_id,
      p_source_fingerprint: row.source_fingerprint,
      p_engine_version: row.engine_version,
      p_computation_batch_id: row.computation_batch_id,
      p_term_result_snapshot_id: row.id,
      p_attendance_snapshot: attendance,
      p_settings_snapshot: settings,
    });

    if (error) {
      failed += 1;
    } else {
      created += 1;
    }
  }

  revalidatePath("/dashboard/report-cards");
  if (created === 0) {
    return {
      ok: false,
      error:
        failed > 0
          ? "No drafts generated. Some cards may be approved/published or blocked."
          : "No drafts generated.",
      details: { created, failed },
    };
  }

  return {
    ok: true,
    message: `Generated or refreshed ${created} draft report card(s).${failed ? ` ${failed} skipped.` : ""}`,
    details: { created, failed },
  };
}

export async function saveReportCardRemarksAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canEditReportCardRemarks(current.profile.role)) {
    return { ok: false, error: "Not authorized to edit remarks." };
  }

  const parsed = saveRemarksSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_report_card_remarks", {
    p_report_card_id: parsed.data.report_card_id,
    p_expected_revision: parsed.data.expected_revision,
    p_teacher_remark: sanitizePlainRemark(parsed.data.teacher_remark ?? null),
    p_headteacher_remark: sanitizePlainRemark(
      parsed.data.headteacher_remark ?? null,
    ),
    p_update_teacher: parsed.data.update_teacher,
    p_update_headteacher: parsed.data.update_headteacher,
  });

  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath(`/dashboard/report-cards/${parsed.data.report_card_id}`);
  return { ok: true, message: "Remarks saved." };
}

export async function markReportCardReviewedAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canReviewReportCards(current.profile.role)) {
    return { ok: false, error: "Not authorized." };
  }
  const parsed = reportCardIdRevisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_report_card_reviewed", {
    p_report_card_id: parsed.data.report_card_id,
    p_expected_revision: parsed.data.expected_revision,
  });
  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath(`/dashboard/report-cards/${parsed.data.report_card_id}`);
  return { ok: true, message: "Marked as reviewed." };
}

async function buildRenderPayloadForCard(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  reportCardId: string,
): Promise<ReportCardRenderPayload | { error: string }> {
  const { data: card } = await supabase
    .from("student_report_cards")
    .select(
      "*",
    )
    .eq("id", reportCardId)
    .maybeSingle();
  if (!card) return { error: "Report card not found." };

  const { data: termSnap } = await supabase
    .from("student_term_result_snapshots")
    .select("*")
    .eq("id", card.term_result_snapshot_id)
    .maybeSingle();
  if (!termSnap) return { error: "Linked term result snapshot missing." };
  if (termSnap.source_fingerprint !== card.source_fingerprint) {
    return { error: "Results have changed; regenerate before approval." };
  }
  if (termSnap.is_stale) {
    return { error: "Results are stale; recalculate before approval." };
  }

  // Gradebook drift (same readiness gate as draft generation).
  const { data: examSnaps } = await supabase
    .from("student_exam_result_snapshots")
    .select("gradebook_id, gradebook_revision")
    .eq("academic_year_id", card.academic_year_id)
    .eq("term_id", card.term_id)
    .eq("class_id", card.class_id)
    .eq("student_id", card.student_id);
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
        return {
          error:
            "Source gradebooks changed or were reopened. Recalculate results before approval.",
        };
      }
    }
  }

  const [
    { data: student },
    { data: classRow },
    { data: year },
    { data: term },
    { data: school },
    { data: subjectRows },
    { data: examRows },
    { data: scheme },
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, first_name, last_name, middle_name, admission_number")
      .eq("id", card.student_id)
      .maybeSingle(),
    supabase
      .from("classes")
      .select("id, name, grade_levels(name), homeroom_teacher_id")
      .eq("id", card.class_id)
      .maybeSingle(),
    supabase
      .from("academic_years")
      .select("id, name")
      .eq("id", card.academic_year_id)
      .maybeSingle(),
    supabase
      .from("terms")
      .select("id, name")
      .eq("id", card.term_id)
      .maybeSingle(),
    supabase
      .from("schools")
      .select("name, motto, address, phone, email, logo_url")
      .eq("id", card.school_id)
      .maybeSingle(),
    supabase
      .from("student_subject_result_snapshots")
      .select(
        "subject_id, weighted_percentage, grade_code, grade_label, grade_point, is_pass, remark, subject_position, subjects(name)",
      )
      .eq("academic_year_id", card.academic_year_id)
      .eq("term_id", card.term_id)
      .eq("class_id", card.class_id)
      .eq("student_id", card.student_id),
    supabase
      .from("student_exam_result_snapshots")
      .select("subject_id, entry_status")
      .eq("academic_year_id", card.academic_year_id)
      .eq("term_id", card.term_id)
      .eq("class_id", card.class_id)
      .eq("student_id", card.student_id),
    supabase
      .from("grading_schemes")
      .select(
        "id, grading_scheme_bands(grade_code, grade_label, minimum_score, maximum_score, is_pass, display_order)",
      )
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle(),
  ]);

  if (!student || !classRow || !year || !term || !school) {
    return { error: "Student, class, or school identity is incomplete." };
  }

  const { data: classTeacher } = classRow.homeroom_teacher_id
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", classRow.homeroom_teacher_id)
        .maybeSingle()
    : { data: null };

  const examStatusesBySubject: Record<string, string[]> = {};
  for (const e of examRows ?? []) {
    const list = examStatusesBySubject[e.subject_id] ?? [];
    list.push(String(e.entry_status));
    examStatusesBySubject[e.subject_id] = list;
  }

  const subjects = mapSubjectRows(
    (subjectRows ?? []).map((s) => ({
      subject_id: s.subject_id,
      subject_name: unwrapOne<{ name: string }>(s.subjects)?.name ?? "Subject",
      weighted_percentage:
        s.weighted_percentage == null ? null : Number(s.weighted_percentage),
      grade_code: s.grade_code,
      grade_label: s.grade_label,
      grade_point: s.grade_point == null ? null : Number(s.grade_point),
      is_pass: s.is_pass,
      remark: s.remark,
      subject_position:
        s.subject_position == null ? null : Number(s.subject_position),
    })),
    examStatusesBySubject,
  );

  const settings =
    (card.settings_snapshot as ReportCardSettings | null) ??
    defaultReportCardSettings();

  const { data: rankingSettings } = await supabase.rpc(
    "ensure_academic_results_settings",
  );
  const rankingRow = unwrapOne<{ ranking_enabled: boolean }>(rankingSettings);

  const bandsRaw = Array.isArray(scheme?.grading_scheme_bands)
    ? scheme!.grading_scheme_bands
    : [];
  const grading_key = bandsRaw
    .map(
      (b: {
        grade_code: string;
        grade_label: string;
        minimum_score: number | string;
        maximum_score: number | string;
        is_pass: boolean;
        display_order: number;
      }) => ({
        grade_code: b.grade_code,
        grade_label: b.grade_label,
        minimum_score: Number(b.minimum_score),
        maximum_score: Number(b.maximum_score),
        is_pass: Boolean(b.is_pass),
        display_order: b.display_order ?? 0,
      }),
    )
    .sort((a, b) => a.display_order - b.display_order)
    .map(({ display_order, ...rest }) => {
      void display_order;
      return rest;
    });

  const payload: ReportCardRenderPayload = {
    schema_version: "2d.2.1",
    source_fingerprint: card.source_fingerprint,
    engine_version: card.engine_version,
    computation_batch_id: card.computation_batch_id,
    template_version: REPORT_CARD_TEMPLATE_VERSION,
    generated_at: new Date().toISOString(),
    school: {
      name: school.name,
      motto: school.motto,
      address: school.address,
      phone: school.phone,
      email: school.email,
      logo_url: school.logo_url,
    },
    academic_year: { id: year.id, name: year.name },
    term: { id: term.id, name: term.name },
    class: {
      id: classRow.id,
      name: classRow.name,
      grade_name:
        unwrapOne<{ name: string }>(classRow.grade_levels)?.name ?? "Grade",
    },
    student: {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      middle_name: student.middle_name,
      admission_number: student.admission_number,
    },
    student_id: student.id,
    class_id: classRow.id,
    subjects,
    summary: {
      average_percentage:
        termSnap.average_percentage == null
          ? null
          : Number(termSnap.average_percentage),
      grade_code: termSnap.grade_code,
      grade_label: termSnap.grade_label,
      grade_point:
        termSnap.grade_point == null ? null : Number(termSnap.grade_point),
      overall_position:
        termSnap.overall_position == null
          ? null
          : Number(termSnap.overall_position),
      tied_count: termSnap.tied_count ?? 0,
      passed_subject_count: termSnap.passed_subject_count ?? 0,
      failed_subject_count: termSnap.failed_subject_count ?? 0,
      scored_subject_count: termSnap.scored_subject_count ?? 0,
      subject_count: termSnap.subject_count ?? subjects.length,
      promotion_outcome: termSnap.promotion_outcome,
      promotion_reason: termSnap.promotion_reason,
      ranking_enabled: rankingRow?.ranking_enabled ?? true,
    },
    attendance: card.attendance_snapshot as ReportCardRenderPayload["attendance"],
    remarks: {
      teacher: card.teacher_remark,
      headteacher: card.headteacher_remark,
    },
    settings,
    grading_key,
    signatories: {
      class_teacher_name: classTeacher?.full_name ?? null,
      headteacher_title: "Head Teacher",
    },
  };

  return payload;
}

export async function approveReportCardAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canApproveReportCards(current.profile.role)) {
    return { ok: false, error: "Not authorized to approve." };
  }
  const parsed = reportCardIdRevisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const payloadOrError = await buildRenderPayloadForCard(
    supabase,
    parsed.data.report_card_id,
  );
  if ("error" in payloadOrError) {
    return { ok: false, error: payloadOrError.error };
  }

  const checksum = checksumRenderPayload(payloadOrError);
  const { error } = await supabase.rpc("approve_report_card", {
    p_report_card_id: parsed.data.report_card_id,
    p_expected_revision: parsed.data.expected_revision,
    p_render_payload: payloadOrError,
    p_render_payload_checksum: checksum,
    p_source_fingerprint: payloadOrError.source_fingerprint,
  });

  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath(`/dashboard/report-cards/${parsed.data.report_card_id}`);
  return { ok: true, message: "Report card approved." };
}

export async function publishReportCardAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canPublishReportCards(current.profile.role)) {
    return { ok: false, error: "Not authorized to publish." };
  }
  const parsed = reportCardIdRevisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("publish_report_card", {
    p_report_card_id: parsed.data.report_card_id,
    p_expected_revision: parsed.data.expected_revision,
  });
  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath(`/dashboard/report-cards/${parsed.data.report_card_id}`);
  return { ok: true, message: "Report card published." };
}

export async function unpublishReportCardAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canPublishReportCards(current.profile.role)) {
    return { ok: false, error: "Not authorized to unpublish." };
  }
  const parsed = unpublishReportCardSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("unpublish_report_card", {
    p_report_card_id: parsed.data.report_card_id,
    p_expected_revision: parsed.data.expected_revision,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath(`/dashboard/report-cards/${parsed.data.report_card_id}`);
  return { ok: true, message: "Report card unpublished." };
}

export async function voidReportCardAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (
    !canApproveReportCards(current.profile.role) &&
    !canPublishReportCards(current.profile.role)
  ) {
    return { ok: false, error: "Not authorized to void." };
  }
  const parsed = voidReportCardSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("void_report_card", {
    p_report_card_id: parsed.data.report_card_id,
    p_expected_revision: parsed.data.expected_revision,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath(`/dashboard/report-cards/${parsed.data.report_card_id}`);
  return { ok: true, message: "Report card voided." };
}

export async function updateReportCardSettingsAction(
  raw: unknown,
): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.profile) return { ok: false, error: "Not signed in." };
  if (!canManageReportCardSettings(current.profile.role)) {
    return { ok: false, error: "Not authorized to manage report-card settings." };
  }
  const parsed = updateReportCardSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_report_card_settings", {
    p_title: parsed.data.title ?? null,
    p_show_school_logo: parsed.data.show_school_logo ?? null,
    p_show_admission_number: parsed.data.show_admission_number ?? null,
    p_show_class_position: parsed.data.show_class_position ?? null,
    p_show_subject_position: parsed.data.show_subject_position ?? null,
    p_show_grade_points: parsed.data.show_grade_points ?? null,
    p_show_promotion_recommendation:
      parsed.data.show_promotion_recommendation ?? null,
    p_show_attendance: parsed.data.show_attendance ?? null,
    p_show_teacher_remark: parsed.data.show_teacher_remark ?? null,
    p_show_headteacher_remark: parsed.data.show_headteacher_remark ?? null,
    p_show_grading_key: parsed.data.show_grading_key ?? null,
    p_show_generated_timestamp: parsed.data.show_generated_timestamp ?? null,
    p_require_teacher_remark_for_review:
      parsed.data.require_teacher_remark_for_review ?? null,
    p_require_headteacher_remark_for_approve:
      parsed.data.require_headteacher_remark_for_approve ?? null,
    p_footer_text:
      parsed.data.footer_text === undefined ? null : parsed.data.footer_text,
    p_ranking_disabled_message: parsed.data.ranking_disabled_message ?? null,
  });
  if (error) return { ok: false, error: normalizeActionError(error.message) };
  revalidatePath("/dashboard/report-cards");
  revalidatePath("/dashboard/settings/report-cards");
  return { ok: true, message: "Report-card settings saved." };
}
