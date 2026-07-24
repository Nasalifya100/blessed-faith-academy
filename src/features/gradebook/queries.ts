"use server";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { mapOpenExamGradebookResponse } from "@/features/gradebook/mappers";
import type { GradebookHubItem, OpenExamGradebookResponse } from "@/features/gradebook/types";
import type { GradebookStatus } from "@/features/gradebook/schemas";
import {
  canLockGradebook,
  canOpenGradebook,
  canReopenGradebook,
  hasGradebookCapability,
} from "@/features/gradebook/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GradebookFilterOptions = {
  academicYearId?: string | null;
  termId?: string | null;
  classId?: string | null;
  subjectId?: string | null;
  status?: string | null;
};

export type GradebookHubContext = {
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
  items: GradebookHubItem[];
};

function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

function relationName(value: unknown): string | null {
  return unwrapOne<{ name: string }>(value)?.name ?? null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isMarksWindowOpen(
  windows: Array<{
    academic_year_id: string;
    term_id: string | null;
    starts_at: string;
    ends_at: string | null;
    is_active: boolean;
  }>,
  academicYearId: string,
  termId: string | null,
): boolean {
  const today = todayIsoDate();
  const candidates = windows.filter(
    (w) =>
      w.is_active &&
      w.academic_year_id === academicYearId &&
      (w.term_id == null || w.term_id === termId),
  );
  if (candidates.length === 0) return true;
  candidates.sort((a, b) => {
    const aExact = a.term_id != null && a.term_id === termId ? 0 : 1;
    const bExact = b.term_id != null && b.term_id === termId ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return b.starts_at.localeCompare(a.starts_at);
  });
  const win = candidates[0];
  if (today < win.starts_at) return false;
  if (win.ends_at != null && today > win.ends_at) return false;
  return true;
}

export async function getGradebookHub(
  filters: GradebookFilterOptions = {},
): Promise<GradebookHubContext | null> {
  const current = await getCurrentUser();
  if (!current?.profile?.is_active || !canOpenGradebook(current.profile.role)) {
    return null;
  }

  const viewAll = hasGradebookCapability(
    current.profile.role,
    "GRADEBOOK_VIEW_ALL",
  );
  const staffId = current.profile.id;
  const supabase = await createSupabaseServerClient();

  const [
    yearsRes,
    termsRes,
    windowsRes,
    assignmentsRes,
    classesRes,
  ] = await Promise.all([
    supabase
      .from("academic_years")
      .select("id, name, is_current")
      .order("starts_on", { ascending: false }),
    supabase
      .from("terms")
      .select("id, name, academic_year_id, is_current, sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("academic_workflow_periods")
      .select(
        "academic_year_id, term_id, starts_at, ends_at, is_active, workflow_type",
      )
      .eq("workflow_type", "MARKS_ENTRY")
      .eq("is_active", true),
    supabase
      .from("teaching_assignments")
      .select(
        `
        id, staff_id, class_id, is_active,
        subject_offerings!inner(
          id, subject_id, grade_level_id, academic_year_id, term_id, class_id, is_active,
          subjects(name),
          grade_levels(name)
        )
      `,
      )
      .eq("is_active", true)
      .eq("subject_offerings.is_active", true),
    supabase
      .from("classes")
      .select(
        "id, name, academic_year_id, grade_level_id, is_active, grade_levels(name)",
      )
      .eq("is_active", true),
  ]);

  const academicYears = (yearsRes.data ?? []) as Array<{
    id: string;
    name: string;
    is_current: boolean;
  }>;
  const terms = (termsRes.data ?? []) as Array<{
    id: string;
    name: string;
    academic_year_id: string;
    is_current: boolean;
  }>;
  const windows = ((windowsRes.data ?? []) as Array<{
    academic_year_id: string;
    term_id: string | null;
    starts_at: string;
    ends_at: string | null;
    is_active: boolean;
  }>).map((w) => ({
    ...w,
    starts_at: String(w.starts_at).slice(0, 10),
    ends_at: w.ends_at ? String(w.ends_at).slice(0, 10) : null,
  }));

  const activeYear =
    academicYears.find((y) => y.is_current) ?? academicYears[0] ?? null;
  const activeYearId = filters.academicYearId || activeYear?.id || null;
  const yearTerms = terms.filter((t) => t.academic_year_id === activeYearId);
  const activeTerm =
    yearTerms.find((t) => t.is_current) ?? yearTerms[0] ?? null;
  const activeTermId =
    filters.termId === "" || filters.termId === "all"
      ? null
      : filters.termId || activeTerm?.id || null;

  type AssignmentRow = {
    id: string;
    staff_id: string;
    class_id: string | null;
    subject_offerings:
      | {
          subject_id: string;
          grade_level_id: string;
          academic_year_id: string;
          term_id: string | null;
          class_id: string | null;
          subjects: { name: string } | null;
          grade_levels: { name: string } | null;
        }
      | {
          subject_id: string;
          grade_level_id: string;
          academic_year_id: string;
          term_id: string | null;
          class_id: string | null;
          subjects: { name: string } | null;
          grade_levels: { name: string } | null;
        }[]
      | null;
  };

  const assignments = (assignmentsRes.data ?? []) as unknown as AssignmentRow[];
  const myAssignments = viewAll
    ? assignments
    : assignments.filter((a) => a.staff_id === staffId);

  const classes = (classesRes.data ?? []) as unknown as Array<{
    id: string;
    name: string;
    academic_year_id: string;
    grade_level_id: string;
    grade_levels: { name: string } | null;
  }>;

  const subjectIds = new Set<string>();
  const assignmentKeys = new Set<string>();

  for (const a of myAssignments) {
    const offering = unwrapOne<{
      subject_id: string;
      grade_level_id: string;
      academic_year_id: string;
      term_id: string | null;
      class_id: string | null;
    }>(a.subject_offerings);
    if (!offering) continue;
    if (activeYearId && offering.academic_year_id !== activeYearId) continue;
    if (
      activeTermId &&
      offering.term_id != null &&
      offering.term_id !== activeTermId
    ) {
      continue;
    }
    subjectIds.add(offering.subject_id);
    const classScope = a.class_id ?? offering.class_id;
    assignmentKeys.add(
      `${offering.subject_id}|${offering.grade_level_id}|${classScope ?? "*"}`,
    );
  }

  let examsQuery = supabase
    .from("exams")
    .select(
      `
      id, exam_reference, status, subject_id, grade_level_id, class_id, max_marks, cohort_scope, is_active,
      subjects(name),
      grade_levels(name),
      exam_periods!inner(id, academic_year_id, term_id, name, academic_years(name), terms(name)),
      exam_schedules(exam_date)
    `,
    )
    .eq("is_active", true)
    .eq("status", "COMPLETED");

  if (activeYearId) {
    examsQuery = examsQuery.eq("exam_periods.academic_year_id", activeYearId);
  }
  if (activeTermId) {
    examsQuery = examsQuery.eq("exam_periods.term_id", activeTermId);
  }
  if (filters.subjectId) {
    examsQuery = examsQuery.eq("subject_id", filters.subjectId);
  }

  const { data: examsData } = await examsQuery.limit(300);
  type ExamRow = {
    id: string;
    exam_reference: string;
    status: string;
    subject_id: string;
    grade_level_id: string;
    class_id: string | null;
    max_marks: number;
    cohort_scope: "GRADE" | "CLASS";
    subjects: { name: string } | null;
    grade_levels: { name: string } | null;
    exam_periods: {
      academic_year_id: string;
      term_id: string | null;
      name: string;
      academic_years: { name: string } | null;
      terms: { name: string } | null;
    } | null;
    exam_schedules:
      | { exam_date: string }[]
      | { exam_date: string }
      | null;
  };

  const exams = (examsData ?? []) as unknown as ExamRow[];

  const { data: gradebooksData } = await supabase
    .from("exam_gradebooks")
    .select(
      "id, exam_id, class_id, status, revision, updated_at, last_saved_at, submitted_at, locked_at",
    )
    .limit(500);

  type GbRow = {
    id: string;
    exam_id: string;
    class_id: string;
    status: GradebookStatus;
    revision: number;
    updated_at: string;
    last_saved_at: string | null;
    submitted_at: string | null;
    locked_at: string | null;
  };
  const gradebookByKey = new Map<string, GbRow>();
  for (const g of (gradebooksData ?? []) as GbRow[]) {
    gradebookByKey.set(`${g.exam_id}|${g.class_id}`, g);
  }

  function assignmentMatches(
    subjectId: string,
    gradeLevelId: string,
    classId: string,
  ): boolean {
    if (viewAll) return true;
    if (assignmentKeys.has(`${subjectId}|${gradeLevelId}|${classId}`)) {
      return true;
    }
    if (assignmentKeys.has(`${subjectId}|${gradeLevelId}|*`)) {
      return true;
    }
    return false;
  }

  const items: GradebookHubItem[] = [];
  const subjectNameById = new Map<string, string>();

  for (const exam of exams) {
    const period = unwrapOne<{
      academic_year_id: string;
      term_id: string | null;
      name: string;
      academic_years: unknown;
      terms: unknown;
    }>(exam.exam_periods);
    if (!period) continue;
    const yearName = relationName(period.academic_years) ?? "";
    const termName = relationName(period.terms);
    const subjectName = relationName(exam.subjects) ?? "Subject";
    subjectNameById.set(exam.subject_id, subjectName);
    const gradeName = relationName(exam.grade_levels) ?? "Grade";
    const schedules = Array.isArray(exam.exam_schedules)
      ? exam.exam_schedules
      : exam.exam_schedules
        ? [exam.exam_schedules]
        : [];
    const examDate = schedules[0]?.exam_date ?? null;
    const marksOpen = isMarksWindowOpen(
      windows,
      period.academic_year_id,
      period.term_id,
    );

    const candidateClasses =
      exam.cohort_scope === "CLASS" && exam.class_id
        ? classes.filter((c) => c.id === exam.class_id)
        : classes.filter(
            (c) =>
              c.grade_level_id === exam.grade_level_id &&
              c.academic_year_id === period.academic_year_id,
          );

    for (const cls of candidateClasses) {
      if (filters.classId && cls.id !== filters.classId) continue;
      const assigned = assignmentMatches(
        exam.subject_id,
        exam.grade_level_id,
        cls.id,
      );
      if (!assigned && !viewAll) continue;

      const gb = gradebookByKey.get(`${exam.id}|${cls.id}`);
      let status: GradebookHubItem["status"] = "READY";
      if (gb) status = gb.status;
      else if (!marksOpen) continue;

      if (filters.status && filters.status !== "all") {
        if (filters.status === "READY" && status !== "READY") continue;
        if (filters.status !== "READY" && status !== filters.status) continue;
      }

      items.push({
        key: `${exam.id}|${cls.id}`,
        exam_id: exam.id,
        class_id: cls.id,
        gradebook_id: gb?.id ?? null,
        status,
        exam_reference: exam.exam_reference,
        exam_name: period.name,
        subject_name: subjectName,
        class_name: cls.name,
        grade_name: relationName(cls.grade_levels) ?? gradeName,
        academic_year_id: period.academic_year_id,
        academic_year_name: yearName,
        term_id: period.term_id,
        term_name: termName,
        max_marks: Number(exam.max_marks),
        exam_date: examDate,
        last_updated_at:
          gb?.last_saved_at ??
          gb?.submitted_at ??
          gb?.locked_at ??
          gb?.updated_at ??
          null,
        revision: gb?.revision ?? null,
        marks_entry_open: marksOpen,
        assigned_to_viewer: assigned || !viewAll,
      });
    }
  }

  items.sort((a, b) => {
    const order = (s: GradebookHubItem["status"]) =>
      s === "REOPENED"
        ? 0
        : s === "DRAFT"
          ? 1
          : s === "READY"
            ? 2
            : s === "SUBMITTED"
              ? 3
              : 4;
    const d = order(a.status) - order(b.status);
    if (d !== 0) return d;
    return a.subject_name.localeCompare(b.subject_name);
  });

  const classOptions = classes
    .filter((c) => !activeYearId || c.academic_year_id === activeYearId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      grade_name: relationName(c.grade_levels) ?? "",
    }));

  const subjects = [...subjectNameById.entries()].map(([id, name]) => ({
    id,
    name,
  }));

  return {
    academicYears,
    terms: yearTerms,
    classes: classOptions,
    subjects,
    activeYearId,
    activeTermId,
    viewAll,
    items,
  };
}

export type GradebookWorkspace = {
  open: OpenExamGradebookResponse;
  viewerUserId: string;
  labels: {
    subject_name: string;
    class_name: string;
    grade_name: string;
    academic_year_name: string;
    term_name: string | null;
    assessment_type_name: string;
    exam_date: string | null;
    submitted_by_name: string | null;
    locked_by_name: string | null;
    opened_by_name: string | null;
  };
  capabilities: {
    can_edit: boolean;
    can_reopen: boolean;
    can_lock: boolean;
  };
};

export async function loadGradebookWorkspace(
  gradebookId: string,
): Promise<GradebookWorkspace | null> {
  const current = await getCurrentUser();
  if (!current?.profile?.is_active || !canOpenGradebook(current.profile.role)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error: openError } = await supabase.rpc("get_exam_gradebook", {
    p_gradebook_id: gradebookId,
  });

  if (openError) return null;
  const open = mapOpenExamGradebookResponse(data);
  if (!open || open.gradebook.id !== gradebookId) return null;

  const lockedBy =
    open.gradebook.locked_by ??
    (typeof (data as { gradebook?: { locked_by?: string } })?.gradebook
      ?.locked_by === "string"
      ? (data as { gradebook: { locked_by: string } }).gradebook.locked_by
      : null);

  const [
    subjectRes,
    classRes,
    yearRes,
    termRes,
    assessmentRes,
    scheduleRes,
    profilesRes,
  ] = await Promise.all([
    supabase
      .from("subjects")
      .select("name")
      .eq("id", open.exam.subject_id)
      .maybeSingle(),
    supabase
      .from("classes")
      .select("name, grade_levels(name)")
      .eq("id", open.gradebook.class_id)
      .maybeSingle(),
    supabase
      .from("academic_years")
      .select("name")
      .eq("id", open.exam.academic_year_id)
      .maybeSingle(),
    open.exam.term_id
      ? supabase
          .from("terms")
          .select("name")
          .eq("id", open.exam.term_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("assessment_types")
      .select("name")
      .eq("id", open.exam.assessment_type_id)
      .maybeSingle(),
    supabase
      .from("exam_schedules")
      .select("exam_date")
      .eq("exam_id", open.exam.id)
      .order("exam_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in(
        "id",
        [
          open.gradebook.submitted_by,
          lockedBy,
          open.gradebook.opened_by,
        ].filter(Boolean) as string[],
      ),
  ]);

  const profileName = (id: string | null | undefined) => {
    if (!id) return null;
    const rows = (profilesRes.data ?? []) as Array<{
      id: string;
      full_name: string;
    }>;
    return rows.find((p) => p.id === id)?.full_name ?? null;
  };

  const classRowRaw = classRes.data as
    | { name: string; grade_levels: unknown }
    | null;
  const classRow = classRowRaw
    ? {
        name: classRowRaw.name,
        grade_levels: unwrapOne<{ name: string }>(classRowRaw.grade_levels),
      }
    : null;

  return {
    open,
    viewerUserId: current.profile.id,
    labels: {
      subject_name: subjectRes.data?.name ?? "Subject",
      class_name: classRow?.name ?? "Class",
      grade_name: classRow?.grade_levels?.name ?? "Grade",
      academic_year_name: yearRes.data?.name ?? "",
      term_name: (termRes.data as { name?: string } | null)?.name ?? null,
      assessment_type_name: assessmentRes.data?.name ?? "",
      exam_date: scheduleRes.data?.exam_date ?? null,
      submitted_by_name: profileName(open.gradebook.submitted_by),
      locked_by_name: profileName(lockedBy),
      opened_by_name: profileName(open.gradebook.opened_by),
    },
    capabilities: {
      can_edit: open.can_edit,
      can_reopen:
        open.gradebook.status === "SUBMITTED" &&
        canReopenGradebook(current.profile.role),
      can_lock:
        open.gradebook.status === "SUBMITTED" &&
        canLockGradebook(current.profile.role),
    },
  };
}
