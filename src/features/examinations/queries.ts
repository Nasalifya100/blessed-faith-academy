"use server";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenExaminations } from "@/features/examinations/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ExamPeriodRow = {
  id: string;
  name: string;
  description: string | null;
  academic_year_id: string;
  term_id: string | null;
  opens_on: string | null;
  closes_on: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED" | "ARCHIVED";
  academic_year_name?: string;
  term_name?: string;
  exam_count?: number;
};

export type ExamRoomRow = {
  id: string;
  name: string;
  capacity: number | null;
  notes: string | null;
  is_active: boolean;
};

export type ExamListItem = {
  id: string;
  exam_period_id: string;
  exam_reference: string;
  status: "DRAFT" | "SCHEDULED" | "READY" | "COMPLETED" | "ARCHIVED";
  subject_id: string;
  grade_level_id: string;
  class_id: string | null;
  assessment_type_id: string;
  max_marks: number;
  instructions: string | null;
  notes: string | null;
  cohort_scope: "GRADE" | "CLASS";
  subject_name: string;
  grade_name: string;
  class_name: string | null;
  assessment_type_name: string;
  schedule: {
    id: string;
    exam_date: string;
    start_time: string;
    end_time: string;
    room_id: string | null;
    room_name: string | null;
    notes: string | null;
    primary_invigilator_id: string | null;
    primary_invigilator_name: string | null;
    assistant_invigilator_id: string | null;
    assistant_invigilator_name: string | null;
  } | null;
};

export type UpcomingExamCard = {
  exam_id: string;
  exam_reference: string;
  subject_name: string;
  grade_name: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  room_name: string | null;
  period_name: string;
  instructions: string | null;
  role_label: string;
  status: string;
};

async function requireExamViewer() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenExaminations(current.profile.role)) {
    return null;
  }
  return current;
}

export async function listExamPeriods(): Promise<ExamPeriodRow[]> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("exam_periods")
    .select(
      "id, name, description, academic_year_id, term_id, opens_on, closes_on, status, academic_years(name), terms(name)",
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const withCounts = await Promise.all(
    rows.map(async (row) => {
      const { count } = await supabase
        .from("exams")
        .select("*", { count: "exact", head: true })
        .eq("exam_period_id", row.id as string)
        .eq("is_active", true);
      const year = row.academic_years as { name?: string } | null;
      const term = row.terms as { name?: string } | null;
      return {
        id: row.id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        academic_year_id: row.academic_year_id as string,
        term_id: (row.term_id as string | null) ?? null,
        opens_on: (row.opens_on as string | null) ?? null,
        closes_on: (row.closes_on as string | null) ?? null,
        status: row.status as ExamPeriodRow["status"],
        academic_year_name: year?.name,
        term_name: term?.name,
        exam_count: count ?? 0,
      };
    }),
  );
  return withCounts;
}

export async function getExamPeriod(
  id: string,
): Promise<ExamPeriodRow | null> {
  if (!(await requireExamViewer())) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("exam_periods")
    .select(
      "id, name, description, academic_year_id, term_id, opens_on, closes_on, status, academic_years(name), terms(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const year = row.academic_years as { name?: string } | null;
  const term = row.terms as { name?: string } | null;
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    academic_year_id: row.academic_year_id as string,
    term_id: (row.term_id as string | null) ?? null,
    opens_on: (row.opens_on as string | null) ?? null,
    closes_on: (row.closes_on as string | null) ?? null,
    status: row.status as ExamPeriodRow["status"],
    academic_year_name: year?.name,
    term_name: term?.name,
  };
}

export async function listExamRooms(activeOnly = false): Promise<ExamRoomRow[]> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("exam_rooms")
    .select("id, name, capacity, notes, is_active")
    .order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data } = await q;
  return (data as ExamRoomRow[] | null) ?? [];
}

export async function listExamStaffCandidates(): Promise<
  { id: string; full_name: string; role: string; is_active: boolean }[]
> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_exam_staff_candidates");
  if (error) return [];
  return (data as { id: string; full_name: string; role: string; is_active: boolean }[]) ?? [];
}

export async function listExamsForPeriod(
  periodId: string,
): Promise<ExamListItem[]> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data: exams } = await supabase
    .from("exams")
    .select(
      "id, exam_period_id, exam_reference, status, subject_id, grade_level_id, class_id, assessment_type_id, max_marks, instructions, notes, cohort_scope, subjects(name), grade_levels(name), classes(name), assessment_types(name)",
    )
    .eq("exam_period_id", periodId)
    .eq("is_active", true)
    .order("exam_reference", { ascending: true });

  const list = (exams ?? []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

  const examIds = list.map((e) => e.id as string);
  const { data: schedules } = await supabase
    .from("exam_schedules")
    .select(
      "id, exam_id, exam_date, start_time, end_time, room_id, notes, exam_rooms(name)",
    )
    .in("exam_id", examIds);

  const scheduleRows = (schedules ?? []) as Array<Record<string, unknown>>;
  const scheduleIds = scheduleRows.map((s) => s.id as string);
  const { data: invigilators } = scheduleIds.length
    ? await supabase
        .from("exam_invigilators")
        .select("exam_schedule_id, staff_id, role, profiles(full_name)")
        .in("exam_schedule_id", scheduleIds)
    : { data: [] };

  const invRows = (invigilators ?? []) as Array<Record<string, unknown>>;

  return list.map((exam) => {
    const schedule = scheduleRows.find((s) => s.exam_id === exam.id) ?? null;
    const invFor = schedule
      ? invRows.filter((i) => i.exam_schedule_id === schedule.id)
      : [];
    const primary = invFor.find((i) => i.role === "PRIMARY");
    const assistant = invFor.find((i) => i.role === "ASSISTANT");
    const subject = exam.subjects as { name?: string } | null;
    const grade = exam.grade_levels as { name?: string } | null;
    const classRow = exam.classes as { name?: string } | null;
    const type = exam.assessment_types as { name?: string } | null;
    const room = schedule?.exam_rooms as { name?: string } | null;
    const primaryProfile = primary?.profiles as { full_name?: string } | null;
    const assistantProfile = assistant?.profiles as {
      full_name?: string;
    } | null;

    return {
      id: exam.id as string,
      exam_period_id: exam.exam_period_id as string,
      exam_reference: (exam.exam_reference as string) ?? "",
      status: exam.status as ExamListItem["status"],
      subject_id: exam.subject_id as string,
      grade_level_id: exam.grade_level_id as string,
      class_id: (exam.class_id as string | null) ?? null,
      assessment_type_id: exam.assessment_type_id as string,
      max_marks: Number(exam.max_marks),
      instructions: (exam.instructions as string | null) ?? null,
      notes: (exam.notes as string | null) ?? null,
      cohort_scope: exam.cohort_scope as "GRADE" | "CLASS",
      subject_name: subject?.name ?? "Subject",
      grade_name: grade?.name ?? "Grade",
      class_name: classRow?.name ?? null,
      assessment_type_name: type?.name ?? "Assessment",
      schedule: schedule
        ? {
            id: schedule.id as string,
            exam_date: schedule.exam_date as string,
            start_time: String(schedule.start_time).slice(0, 5),
            end_time: String(schedule.end_time).slice(0, 5),
            room_id: (schedule.room_id as string | null) ?? null,
            room_name: room?.name ?? null,
            notes: (schedule.notes as string | null) ?? null,
            primary_invigilator_id: (primary?.staff_id as string | null) ?? null,
            primary_invigilator_name: primaryProfile?.full_name ?? null,
            assistant_invigilator_id:
              (assistant?.staff_id as string | null) ?? null,
            assistant_invigilator_name: assistantProfile?.full_name ?? null,
          }
        : null,
    };
  });
}

export async function listExamTemplates(): Promise<
  { id: string; name: string; description: string | null; item_count: number }[]
> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("exam_templates")
    .select("id, name, description")
    .eq("is_active", true)
    .order("name");
  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  return Promise.all(
    rows.map(async (row) => {
      const { count } = await supabase
        .from("exam_template_items")
        .select("*", { count: "exact", head: true })
        .eq("exam_template_id", row.id);
      return { ...row, item_count: count ?? 0 };
    }),
  );
}

export async function listUpcomingExamsForCurrentUser(): Promise<
  UpcomingExamCard[]
> {
  const current = await requireExamViewer();
  if (!current?.profile) return [];
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: invigilatorRows } = await supabase
    .from("exam_invigilators")
    .select(
      "role, exam_schedules!inner(id, exam_date, start_time, end_time, exam_id, exam_rooms(name), exams!inner(id, exam_reference, status, instructions, subjects(name), grade_levels(name), exam_periods!inner(name, status)))",
    )
    .eq("staff_id", current.profile.id);

  const cards: UpcomingExamCard[] = [];
  for (const row of (invigilatorRows ?? []) as Array<Record<string, unknown>>) {
    const schedule = row.exam_schedules as Record<string, unknown> | null;
    if (!schedule) continue;
    const exam = schedule.exams as Record<string, unknown> | null;
    if (!exam) continue;
    const period = exam.exam_periods as { name?: string; status?: string } | null;
    if (period?.status === "ARCHIVED") continue;
    if (exam.status === "ARCHIVED") continue;
    const examDate = String(schedule.exam_date);
    if (examDate < today) continue;
    const subject = exam.subjects as { name?: string } | null;
    const grade = exam.grade_levels as { name?: string } | null;
    const room = schedule.exam_rooms as { name?: string } | null;
    cards.push({
      exam_id: exam.id as string,
      exam_reference: (exam.exam_reference as string) ?? "",
      subject_name: subject?.name ?? "Exam",
      grade_name: grade?.name ?? "",
      exam_date: examDate,
      start_time: String(schedule.start_time).slice(0, 5),
      end_time: String(schedule.end_time).slice(0, 5),
      room_name: room?.name ?? null,
      period_name: period?.name ?? "Exam period",
      instructions: (exam.instructions as string | null) ?? null,
      role_label: row.role === "PRIMARY" ? "Primary invigilator" : "Assistant",
      status: String(exam.status ?? "DRAFT"),
    });
  }

  cards.sort((a, b) =>
    `${a.exam_date}${a.start_time}`.localeCompare(`${b.exam_date}${b.start_time}`),
  );
  return cards;
}

export async function listExclusionsForExam(examId: string): Promise<
  {
    id: string;
    student_id: string;
    student_name: string;
    reason: string;
    notes: string | null;
  }[]
> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("exam_exclusions")
    .select("id, student_id, reason, notes, students(first_name, last_name)")
    .eq("exam_id", examId);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const student = row.students as {
      first_name?: string;
      last_name?: string;
    } | null;
    return {
      id: row.id as string,
      student_id: row.student_id as string,
      student_name: [student?.first_name, student?.last_name]
        .filter(Boolean)
        .join(" "),
      reason: row.reason as string,
      notes: (row.notes as string | null) ?? null,
    };
  });
}

export async function searchExamsByReference(
  query: string,
): Promise<ExamListItem[]> {
  const q = query.trim();
  if (!q || !(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("exams")
    .select("id, exam_period_id")
    .ilike("exam_reference", `%${q}%`)
    .limit(20);
  const periodIds = [
    ...new Set(
      ((data ?? []) as Array<{ exam_period_id: string }>).map(
        (r) => r.exam_period_id,
      ),
    ),
  ];
  const items: ExamListItem[] = [];
  for (const periodId of periodIds) {
    const exams = await listExamsForPeriod(periodId);
    items.push(
      ...exams.filter((e) =>
        e.exam_reference.toLowerCase().includes(q.toLowerCase()),
      ),
    );
  }
  return items;
}

export async function getExamStatusBlockers(
  examId: string,
  target: ExamListItem["status"],
): Promise<{ code: string; label: string; href_hint?: string }[]> {
  if (!(await requireExamViewer())) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("exam_status_blockers", {
    p_exam_id: examId,
    p_target: target,
  });
  if (error || !Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => ({
    code: String(row.code ?? ""),
    label: String(row.label ?? ""),
    href_hint: row.href_hint ? String(row.href_hint) : undefined,
  }));
}

export async function getSchoolBrandForPrint(): Promise<{
  name: string;
  motto: string | null;
  address: string | null;
  phone: string | null;
} | null> {
  const current = await requireExamViewer();
  if (!current?.profile?.school_id) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("schools")
    .select("name, motto, address, phone")
    .eq("id", current.profile.school_id)
    .maybeSingle();
  return (data as {
    name: string;
    motto: string | null;
    address: string | null;
    phone: string | null;
  } | null) ?? null;
}
