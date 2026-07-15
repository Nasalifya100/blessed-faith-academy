import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentYearClasses } from "@/features/students/queries";

function fullName(parts: {
  first_name: string;
  middle_name: string | null;
  last_name: string;
}): string {
  return [parts.first_name, parts.middle_name, parts.last_name]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Fee balances (current academic year)
// ---------------------------------------------------------------------------

export interface FeeBalanceRow {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  className: string | null;
  totalCharged: number;
  totalPaid: number;
  balance: number;
}

export interface FeeBalancesReport {
  academicYearName: string | null;
  rows: FeeBalanceRow[];
  totals: {
    charged: number;
    paid: number;
    balance: number;
    studentsWithBalance: number;
  };
}

export async function getFeeBalancesReport(options?: {
  outstandingOnly?: boolean;
}): Promise<FeeBalancesReport> {
  const supabase = await createSupabaseServerClient();
  const outstandingOnly = options?.outstandingOnly ?? true;

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  if (!year?.id) {
    return {
      academicYearName: null,
      rows: [],
      totals: { charged: 0, paid: 0, balance: 0, studentsWithBalance: 0 },
    };
  }

  const { data: studentRows } = await supabase
    .from("students")
    .select("id, admission_number, first_name, middle_name, last_name")
    .eq("status", "enrolled")
    .order("last_name", { ascending: true });

  const students =
    (studentRows as {
      id: string;
      admission_number: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    }[] | null) ?? [];

  if (students.length === 0) {
    return {
      academicYearName: year.name,
      rows: [],
      totals: { charged: 0, paid: 0, balance: 0, studentsWithBalance: 0 },
    };
  }

  const studentIds = students.map((s) => s.id);

  const { data: enrolRows } = await supabase
    .from("student_class_enrollments")
    .select(
      "student_id, class:classes(name, grade_level:grade_levels(name))",
    )
    .eq("academic_year_id", year.id)
    .eq("status", "active")
    .in("student_id", studentIds);

  const classByStudent = new Map<string, string>();
  for (const row of (enrolRows as unknown as {
    student_id: string;
    class: {
      name: string;
      grade_level: { name: string } | null;
    } | null;
  }[] | null) ?? []) {
    if (!row.class) continue;
    classByStudent.set(
      row.student_id,
      row.class.grade_level?.name ?? row.class.name,
    );
  }

  const { data: chargeRows } = await supabase
    .from("charges")
    .select("student_id, amount, status")
    .eq("academic_year_id", year.id)
    .neq("status", "cancelled")
    .in("student_id", studentIds);

  const chargedByStudent = new Map<string, number>();
  for (const row of (chargeRows as {
    student_id: string;
    amount: number | string;
    status: string;
  }[] | null) ?? []) {
    if (row.status === "waived") continue;
    chargedByStudent.set(
      row.student_id,
      (chargedByStudent.get(row.student_id) ?? 0) + Number(row.amount),
    );
  }

  const { data: paymentRows } = await supabase
    .from("payments")
    .select("student_id, amount")
    .eq("status", "completed")
    .in("student_id", studentIds);

  const paidByStudent = new Map<string, number>();
  for (const row of (paymentRows as {
    student_id: string;
    amount: number | string;
  }[] | null) ?? []) {
    paidByStudent.set(
      row.student_id,
      (paidByStudent.get(row.student_id) ?? 0) + Number(row.amount),
    );
  }

  let rows: FeeBalanceRow[] = students.map((student) => {
    const totalCharged = chargedByStudent.get(student.id) ?? 0;
    const totalPaid = paidByStudent.get(student.id) ?? 0;
    return {
      studentId: student.id,
      admissionNumber: student.admission_number,
      fullName: fullName(student),
      className: classByStudent.get(student.id) ?? null,
      totalCharged,
      totalPaid,
      balance: totalCharged - totalPaid,
    };
  });

  if (outstandingOnly) {
    rows = rows.filter((row) => row.balance > 0.005);
  }

  rows.sort((a, b) => b.balance - a.balance);

  const totals = {
    charged: rows.reduce((sum, row) => sum + row.totalCharged, 0),
    paid: rows.reduce((sum, row) => sum + row.totalPaid, 0),
    balance: rows.reduce((sum, row) => sum + row.balance, 0),
    studentsWithBalance: rows.filter((row) => row.balance > 0.005).length,
  };

  return {
    academicYearName: year.name,
    rows,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Attendance by class (current year, optional date range)
// ---------------------------------------------------------------------------

export interface ClassAttendanceSummaryRow {
  classId: string;
  className: string;
  daysRecorded: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  totalMarks: number;
  attendanceRate: number;
}

export interface AttendanceByClassReport {
  academicYearName: string | null;
  fromDate: string | null;
  toDate: string | null;
  rows: ClassAttendanceSummaryRow[];
}

export async function getAttendanceByClassReport(options?: {
  fromDate?: string;
  toDate?: string;
}): Promise<AttendanceByClassReport> {
  const supabase = await createSupabaseServerClient();
  const { academicYearName, classes } = await getCurrentYearClasses();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, start_date, end_date")
    .eq("is_current", true)
    .maybeSingle();

  if (!year?.id || classes.length === 0) {
    return {
      academicYearName,
      fromDate: null,
      toDate: null,
      rows: [],
    };
  }

  const yearInfo = year as {
    id: string;
    start_date: string;
    end_date: string;
  };

  const fromDate = options?.fromDate ?? yearInfo.start_date;
  const toDate = options?.toDate ?? yearInfo.end_date;
  const classIds = classes.map((c) => c.id);

  const { data: markRows } = await supabase
    .from("attendance_records")
    .select("class_id, attendance_date, status")
    .in("class_id", classIds)
    .gte("attendance_date", fromDate)
    .lte("attendance_date", toDate);

  type Agg = {
    dates: Set<string>;
    present: number;
    absent: number;
    late: number;
    excused: number;
  };

  const byClass = new Map<string, Agg>();
  for (const id of classIds) {
    byClass.set(id, {
      dates: new Set(),
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    });
  }

  for (const row of (markRows as {
    class_id: string;
    attendance_date: string;
    status: string;
  }[] | null) ?? []) {
    const agg = byClass.get(row.class_id);
    if (!agg) continue;
    agg.dates.add(row.attendance_date);
    if (row.status === "present") agg.present += 1;
    else if (row.status === "absent") agg.absent += 1;
    else if (row.status === "late") agg.late += 1;
    else if (row.status === "excused") agg.excused += 1;
  }

  const rows: ClassAttendanceSummaryRow[] = classes.map((cls) => {
    const agg = byClass.get(cls.id)!;
    const totalMarks =
      agg.present + agg.absent + agg.late + agg.excused;
    const inSchool = agg.present + agg.late;
    return {
      classId: cls.id,
      className: cls.gradeName,
      daysRecorded: agg.dates.size,
      present: agg.present,
      absent: agg.absent,
      late: agg.late,
      excused: agg.excused,
      totalMarks,
      attendanceRate:
        totalMarks > 0 ? Math.round((inSchool / totalMarks) * 100) : 0,
    };
  });

  return {
    academicYearName,
    fromDate,
    toDate,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Enrolment by class
// ---------------------------------------------------------------------------

export interface EnrolmentByClassRow {
  classId: string;
  className: string;
  enrolledCount: number;
  capacity: number | null;
}

export interface EnrolmentByClassReport {
  academicYearName: string | null;
  rows: EnrolmentByClassRow[];
  totalEnrolled: number;
}

export async function getEnrolmentByClassReport(): Promise<EnrolmentByClassReport> {
  const supabase = await createSupabaseServerClient();
  const { academicYearId, academicYearName, classes } =
    await getCurrentYearClasses();

  if (!academicYearId || classes.length === 0) {
    return { academicYearName, rows: [], totalEnrolled: 0 };
  }

  const { data: classMeta } = await supabase
    .from("classes")
    .select("id, capacity")
    .eq("academic_year_id", academicYearId)
    .eq("is_active", true);

  const capacityById = new Map<string, number | null>();
  for (const row of (classMeta as {
    id: string;
    capacity: number | null;
  }[] | null) ?? []) {
    capacityById.set(row.id, row.capacity);
  }

  const { data: enrolRows } = await supabase
    .from("student_class_enrollments")
    .select("class_id")
    .eq("academic_year_id", academicYearId)
    .eq("status", "active");

  const countByClass = new Map<string, number>();
  for (const row of (enrolRows as { class_id: string }[] | null) ?? []) {
    countByClass.set(row.class_id, (countByClass.get(row.class_id) ?? 0) + 1);
  }

  const rows: EnrolmentByClassRow[] = classes.map((cls) => ({
    classId: cls.id,
    className: cls.gradeName,
    enrolledCount: countByClass.get(cls.id) ?? 0,
    capacity: capacityById.get(cls.id) ?? null,
  }));

  return {
    academicYearName,
    rows,
    totalEnrolled: rows.reduce((sum, row) => sum + row.enrolledCount, 0),
  };
}

// ---------------------------------------------------------------------------
// Discipline snapshot
// ---------------------------------------------------------------------------

export interface DisciplineSnapshotReport {
  openCount: number;
  resolvedCount: number;
  highOpenCount: number;
}

export async function getDisciplineSnapshotReport(): Promise<DisciplineSnapshotReport> {
  const supabase = await createSupabaseServerClient();

  const { data: openRows } = await supabase
    .from("discipline_incidents")
    .select("id, severity")
    .eq("status", "open");

  const { count: resolvedCount } = await supabase
    .from("discipline_incidents")
    .select("id", { count: "exact", head: true })
    .eq("status", "resolved");

  const open =
    (openRows as { id: string; severity: string }[] | null) ?? [];

  return {
    openCount: open.length,
    resolvedCount: resolvedCount ?? 0,
    highOpenCount: open.filter((row) => row.severity === "high").length,
  };
}
