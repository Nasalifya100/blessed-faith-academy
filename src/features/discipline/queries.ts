import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DisciplineSeverity, DisciplineStatus } from "./schemas";

export interface SchoolRuleRow {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
}

export async function listSchoolRules(options?: {
  activeOnly?: boolean;
}): Promise<SchoolRuleRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("school_rules")
    .select("id, title, body, sort_order, is_active")
    .order("sort_order", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data } = await query;

  return (
    (data as {
      id: string;
      title: string;
      body: string;
      sort_order: number;
      is_active: boolean;
    }[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
}

export interface DisciplineIncidentRow {
  id: string;
  incidentDate: string;
  title: string;
  description: string;
  actionTaken: string;
  severity: DisciplineSeverity;
  status: DisciplineStatus;
  relatedRuleTitle: string | null;
  recordedByName: string | null;
  resolvedAt: string | null;
}

export async function listStudentDisciplineIncidents(
  studentId: string,
): Promise<DisciplineIncidentRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("discipline_incidents")
    .select(
      "id, incident_date, title, description, action_taken, severity, status, resolved_at, related_rule:school_rules(title), recorded_by",
    )
    .eq("student_id", studentId)
    .order("incident_date", { ascending: false })
    .order("created_at", { ascending: false });

  const rows =
    (data as unknown as {
      id: string;
      incident_date: string;
      title: string;
      description: string | null;
      action_taken: string | null;
      severity: DisciplineSeverity;
      status: DisciplineStatus;
      resolved_at: string | null;
      related_rule: { title: string } | null;
      recorded_by: string | null;
    }[] | null) ?? [];

  const recorderIds = [
    ...new Set(rows.map((r) => r.recorded_by).filter(Boolean) as string[]),
  ];
  const nameById = new Map<string, string>();

  if (recorderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", recorderIds);
    for (const profile of (profiles as {
      id: string;
      full_name: string;
    }[] | null) ?? []) {
      nameById.set(profile.id, profile.full_name);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    incidentDate: row.incident_date,
    title: row.title,
    description: row.description ?? "",
    actionTaken: row.action_taken ?? "",
    severity: row.severity,
    status: row.status,
    relatedRuleTitle: row.related_rule?.title ?? null,
    recordedByName: row.recorded_by
      ? (nameById.get(row.recorded_by) ?? null)
      : null,
    resolvedAt: row.resolved_at,
  }));
}

export interface SchoolDisciplineIncidentRow extends DisciplineIncidentRow {
  studentId: string;
  studentName: string;
  admissionNumber: string;
}

export async function listSchoolDisciplineIncidents(options?: {
  status?: DisciplineStatus | "all";
  limit?: number;
}): Promise<SchoolDisciplineIncidentRow[]> {
  const supabase = await createSupabaseServerClient();
  const status = options?.status ?? "open";
  const limit = options?.limit ?? 100;

  let query = supabase
    .from("discipline_incidents")
    .select(
      "id, student_id, incident_date, title, description, action_taken, severity, status, resolved_at, related_rule:school_rules(title), recorded_by, student:students(id, first_name, middle_name, last_name, admission_number)",
    )
    .order("incident_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data } = await query;

  const rows =
    (data as unknown as {
      id: string;
      student_id: string;
      incident_date: string;
      title: string;
      description: string | null;
      action_taken: string | null;
      severity: DisciplineSeverity;
      status: DisciplineStatus;
      resolved_at: string | null;
      related_rule: { title: string } | null;
      recorded_by: string | null;
      student: {
        id: string;
        first_name: string;
        middle_name: string | null;
        last_name: string;
        admission_number: string;
      } | null;
    }[] | null) ?? [];

  const recorderIds = [
    ...new Set(rows.map((r) => r.recorded_by).filter(Boolean) as string[]),
  ];
  const nameById = new Map<string, string>();

  if (recorderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", recorderIds);
    for (const profile of (profiles as {
      id: string;
      full_name: string;
    }[] | null) ?? []) {
      nameById.set(profile.id, profile.full_name);
    }
  }

  return rows
    .filter((row) => row.student)
    .map((row) => {
      const student = row.student!;
      return {
        id: row.id,
        studentId: student.id,
        studentName: [student.first_name, student.middle_name, student.last_name]
          .filter(Boolean)
          .join(" "),
        admissionNumber: student.admission_number,
        incidentDate: row.incident_date,
        title: row.title,
        description: row.description ?? "",
        actionTaken: row.action_taken ?? "",
        severity: row.severity,
        status: row.status,
        relatedRuleTitle: row.related_rule?.title ?? null,
        recordedByName: row.recorded_by
          ? (nameById.get(row.recorded_by) ?? null)
          : null,
        resolvedAt: row.resolved_at,
      };
    });
}
