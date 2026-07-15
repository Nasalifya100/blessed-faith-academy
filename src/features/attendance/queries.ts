import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getCurrentYearClasses } from "@/features/students/queries";
import type { AttendanceStatus } from "./schemas";

export interface AttendanceClassOption {
  id: string;
  name: string;
  gradeName: string;
  sortOrder: number;
  homeroomTeacherId: string | null;
  homeroomTeacherName: string | null;
  accessReason: "office" | "homeroom" | "cover";
}

export interface ListResult<T> {
  items: T[];
  error: string | null;
}

function friendlyAttendanceRpcError(
  message: string,
  functionName: string,
): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("could not find the function") ||
    lower.includes("does not exist") ||
    (lower.includes(functionName.toLowerCase()) &&
      lower.includes("schema cache"))
  ) {
    return `Database helper missing (${functionName}). In Supabase SQL Editor, run migration 20260715240100_attendance_ui_helpers.sql, then refresh this page.`;
  }
  return message;
}

/**
 * Classes the current user may take attendance for.
 * Falls back to current-year classes for office roles if the RPC is missing.
 */
export async function listClassesForAttendance(): Promise<
  ListResult<AttendanceClassOption>
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_classes_for_attendance");

  if (error) {
    const friendly = friendlyAttendanceRpcError(
      error.message,
      "list_classes_for_attendance",
    );
    const fallback = await fallbackOfficeClasses();
    if (fallback.length > 0) {
      return {
        items: fallback,
        error: `${friendly} Showing classes from a temporary fallback.`,
      };
    }
    return { items: [], error: friendly };
  }

  const items = (
    (data as {
      id: string;
      name: string;
      grade_name: string;
      sort_order: number;
      homeroom_teacher_id: string | null;
      homeroom_teacher_name: string | null;
      access_reason: string;
    }[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    gradeName: row.grade_name,
    sortOrder: row.sort_order,
    homeroomTeacherId: row.homeroom_teacher_id,
    homeroomTeacherName: row.homeroom_teacher_name,
    accessReason: row.access_reason as AttendanceClassOption["accessReason"],
  }));

  return { items, error: null };
}

async function fallbackOfficeClasses(): Promise<AttendanceClassOption[]> {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (
    !role ||
    !["administrator", "headteacher", "secretary"].includes(role)
  ) {
    return [];
  }

  const { classes } = await getCurrentYearClasses();
  return classes.map((cls) => ({
    id: cls.id,
    name: cls.name,
    gradeName: cls.gradeName,
    sortOrder: cls.sortOrder,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    accessReason: "office" as const,
  }));
}

export interface TeacherOption {
  id: string;
  fullName: string;
}

export async function listTeachersForCover(): Promise<
  ListResult<TeacherOption>
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_teachers_for_cover");

  if (error) {
    return {
      items: [],
      error: friendlyAttendanceRpcError(error.message, "list_teachers_for_cover"),
    };
  }

  const items = ((data as { id: string; full_name: string }[] | null) ?? []).map(
    (row) => ({
      id: row.id,
      fullName: row.full_name,
    }),
  );

  return { items, error: null };
}

export interface AttendanceRosterStudent {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  status: AttendanceStatus;
  notes: string;
  hasExistingMark: boolean;
}

export interface ClassAttendanceRegister {
  classId: string;
  className: string;
  gradeName: string;
  attendanceDate: string;
  students: AttendanceRosterStudent[];
  summary: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    total: number;
  };
}

export async function getClassAttendanceRegister(
  classId: string,
  attendanceDate: string,
): Promise<ClassAttendanceRegister | null> {
  const supabase = await createSupabaseServerClient();

  const { data: classRow } = await supabase
    .from("classes")
    .select("id, name, academic_year_id, grade_level:grade_levels(name)")
    .eq("id", classId)
    .eq("is_active", true)
    .maybeSingle();

  if (!classRow) {
    return null;
  }

  const cls = classRow as unknown as {
    id: string;
    name: string;
    academic_year_id: string;
    grade_level: { name: string } | null;
  };

  const { data: enrolRows } = await supabase
    .from("student_class_enrollments")
    .select(
      "student:students(id, admission_number, first_name, middle_name, last_name, status)",
    )
    .eq("class_id", classId)
    .eq("academic_year_id", cls.academic_year_id)
    .eq("status", "active");

  const enrolled = (
    (enrolRows as unknown as {
      student: {
        id: string;
        admission_number: string;
        first_name: string;
        middle_name: string | null;
        last_name: string;
        status: string;
      } | null;
    }[] | null) ?? []
  )
    .map((row) => row.student)
    .filter(
      (student): student is NonNullable<typeof student> =>
        Boolean(student) && student!.status === "enrolled",
    )
    .sort((a, b) => {
      const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
      const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const { data: markRows } = await supabase
    .from("attendance_records")
    .select("student_id, status, notes")
    .eq("class_id", classId)
    .eq("attendance_date", attendanceDate);

  const markByStudent = new Map<
    string,
    { status: AttendanceStatus; notes: string }
  >();
  for (const row of (markRows as {
    student_id: string;
    status: AttendanceStatus;
    notes: string | null;
  }[] | null) ?? []) {
    markByStudent.set(row.student_id, {
      status: row.status,
      notes: row.notes ?? "",
    });
  }

  const students: AttendanceRosterStudent[] = enrolled.map((student) => {
    const existing = markByStudent.get(student.id);
    return {
      studentId: student.id,
      admissionNumber: student.admission_number,
      fullName: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),
      status: existing?.status ?? "present",
      notes: existing?.notes ?? "",
      hasExistingMark: Boolean(existing),
    };
  });

  const summary = {
    present: students.filter((s) => s.status === "present").length,
    absent: students.filter((s) => s.status === "absent").length,
    late: students.filter((s) => s.status === "late").length,
    excused: students.filter((s) => s.status === "excused").length,
    total: students.length,
  };

  return {
    classId: cls.id,
    className: cls.name,
    gradeName: cls.grade_level?.name ?? cls.name,
    attendanceDate,
    students,
    summary,
  };
}

export interface AttendanceCoverRow {
  id: string;
  classId: string;
  className: string;
  staffId: string;
  staffName: string;
  validFrom: string;
  validUntil: string | null;
  reason: string;
  isActive: boolean;
}

export async function listActiveAttendanceCovers(): Promise<
  AttendanceCoverRow[]
> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("class_attendance_covers")
    .select(
      "id, class_id, staff_id, valid_from, valid_until, reason, is_active, class:classes(name)",
    )
    .eq("is_active", true)
    .order("valid_from", { ascending: false });

  const rows =
    (data as {
      id: string;
      class_id: string;
      staff_id: string;
      valid_from: string;
      valid_until: string | null;
      reason: string;
      is_active: boolean;
      class: { name: string } | null;
    }[] | null) ?? [];

  const staffIds = [...new Set(rows.map((row) => row.staff_id))];
  const nameById = new Map<string, string>();

  if (staffIds.length > 0) {
    // Prefer the cover-manager RPC list (avoids profiles RLS gaps).
    const { items: teachers } = await listTeachersForCover();
    for (const teacher of teachers) {
      nameById.set(teacher.id, teacher.fullName);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    classId: row.class_id,
    className: row.class?.name ?? "-",
    staffId: row.staff_id,
    staffName: nameById.get(row.staff_id) ?? "Teacher",
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    reason: row.reason,
    isActive: row.is_active,
  }));
}

// ---------------------------------------------------------------------------
// Student attendance history (current academic year)
// ---------------------------------------------------------------------------

export interface StudentAttendanceDay {
  id: string;
  date: string;
  status: AttendanceStatus;
  notes: string;
  className: string;
}

export interface AttendanceCorrection {
  id: string;
  attendanceRecordId: string;
  date: string;
  oldStatus: AttendanceStatus;
  newStatus: AttendanceStatus;
  oldNotes: string;
  newNotes: string;
  changedAt: string;
  changedByName: string | null;
}

export interface StudentAttendanceHistory {
  academicYearName: string | null;
  days: StudentAttendanceDay[];
  corrections: AttendanceCorrection[];
  summary: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    total: number;
  };
}

export async function getStudentAttendanceHistory(
  studentId: string,
  options?: { limit?: number },
): Promise<StudentAttendanceHistory> {
  const supabase = await createSupabaseServerClient();
  const limit = options?.limit ?? 40;

  const empty: StudentAttendanceHistory = {
    academicYearName: null,
    days: [],
    corrections: [],
    summary: { present: 0, absent: 0, late: 0, excused: 0, total: 0 },
  };

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name, start_date, end_date")
    .eq("is_current", true)
    .maybeSingle();

  if (!year?.id) {
    return empty;
  }

  const yearInfo = year as {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
  };

  const { data: markRows } = await supabase
    .from("attendance_records")
    .select(
      "id, attendance_date, status, notes, class:classes(name, academic_year_id)",
    )
    .eq("student_id", studentId)
    .gte("attendance_date", yearInfo.start_date)
    .lte("attendance_date", yearInfo.end_date)
    .order("attendance_date", { ascending: false })
    .limit(limit);

  const days: StudentAttendanceDay[] = (
    (markRows as unknown as {
      id: string;
      attendance_date: string;
      status: AttendanceStatus;
      notes: string | null;
      class: { name: string; academic_year_id: string } | null;
    }[] | null) ?? []
  )
    .filter(
      (row) =>
        !row.class?.academic_year_id ||
        row.class.academic_year_id === yearInfo.id,
    )
    .map((row) => ({
      id: row.id,
      date: row.attendance_date,
      status: row.status,
      notes: row.notes ?? "",
      className: row.class?.name ?? "-",
    }));

  // Full-year counts (not limited to recent rows)
  const { data: countRows } = await supabase
    .from("attendance_records")
    .select("status, class:classes(academic_year_id)")
    .eq("student_id", studentId)
    .gte("attendance_date", yearInfo.start_date)
    .lte("attendance_date", yearInfo.end_date);

  const statuses = (
    (countRows as unknown as {
      status: AttendanceStatus;
      class: { academic_year_id: string } | null;
    }[] | null) ?? []
  )
    .filter(
      (row) =>
        !row.class?.academic_year_id ||
        row.class.academic_year_id === yearInfo.id,
    )
    .map((row) => row.status);

  const summary = {
    present: statuses.filter((s) => s === "present").length,
    absent: statuses.filter((s) => s === "absent").length,
    late: statuses.filter((s) => s === "late").length,
    excused: statuses.filter((s) => s === "excused").length,
    total: statuses.length,
  };

  const { data: auditRows } = await supabase
    .from("attendance_record_audits")
    .select(
      "id, attendance_record_id, attendance_date, old_status, new_status, old_notes, new_notes, changed_at, changed_by",
    )
    .eq("student_id", studentId)
    .gte("attendance_date", yearInfo.start_date)
    .lte("attendance_date", yearInfo.end_date)
    .order("changed_at", { ascending: false })
    .limit(20);

  const audits =
    (auditRows as {
      id: string;
      attendance_record_id: string;
      attendance_date: string;
      old_status: AttendanceStatus;
      new_status: AttendanceStatus;
      old_notes: string | null;
      new_notes: string | null;
      changed_at: string;
      changed_by: string | null;
    }[] | null) ?? [];

  const changerIds = [
    ...new Set(
      audits
        .map((row) => row.changed_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const nameById = new Map<string, string>();
  if (changerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", changerIds);
    for (const profile of (profiles as { id: string; full_name: string }[] | null) ??
      []) {
      nameById.set(profile.id, profile.full_name);
    }
  }

  const corrections: AttendanceCorrection[] = audits.map((row) => ({
    id: row.id,
    attendanceRecordId: row.attendance_record_id,
    date: row.attendance_date,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    oldNotes: row.old_notes ?? "",
    newNotes: row.new_notes ?? "",
    changedAt: row.changed_at,
    changedByName: row.changed_by
      ? (nameById.get(row.changed_by) ?? null)
      : null,
  }));

  return {
    academicYearName: yearInfo.name,
    days,
    corrections,
    summary,
  };
}
