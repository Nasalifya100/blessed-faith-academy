import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ClassOption {
  id: string;
  name: string;
  gradeName: string;
  sortOrder: number;
}

export interface CurrentYearClasses {
  academicYearId: string | null;
  academicYearName: string | null;
  classes: ClassOption[];
}

export interface EnrolmentFormData {
  academicYearName: string | null;
  classes: ClassOption[];
  suggestedAdmissionNumber: string | null;
}

interface ClassRow {
  id: string;
  name: string;
  grade_level: { name: string; sort_order: number } | null;
}

/**
 * The classes running in the current academic year, sorted by grade.
 * Shared by the enrolment form and the student-list class filter.
 */
export async function getCurrentYearClasses(): Promise<CurrentYearClasses> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  if (!year?.id) {
    return { academicYearId: null, academicYearName: null, classes: [] };
  }

  const { data: classRows } = await supabase
    .from("classes")
    .select("id, name, grade_level:grade_levels(name, sort_order)")
    .eq("academic_year_id", year.id)
    .eq("is_active", true);

  const classes = ((classRows as ClassRow[] | null) ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      gradeName: row.grade_level?.name ?? row.name,
      sortOrder: row.grade_level?.sort_order ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    academicYearId: year.id,
    academicYearName: year.name,
    classes,
  };
}

/**
 * Data needed by the "Add student" form.
 */
export async function getEnrolmentFormData(): Promise<EnrolmentFormData> {
  const supabase = await createSupabaseServerClient();
  const { academicYearName, classes } = await getCurrentYearClasses();

  const { data: suggested } = await supabase.rpc("suggest_admission_number");

  return {
    academicYearName,
    classes,
    suggestedAdmissionNumber:
      typeof suggested === "string" ? suggested : null,
  };
}

// ---------------------------------------------------------------------------
// Student list
// ---------------------------------------------------------------------------

export interface StudentListFilters {
  q?: string;
  status?: string;
  classId?: string;
}

export interface StudentListItem {
  id: string;
  admissionNumber: string;
  fullName: string;
  gender: string;
  status: string;
  className: string | null;
}

interface StudentRow {
  id: string;
  admission_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string;
  status: string;
}

interface EnrolmentClassRow {
  student_id: string;
  class: { name: string; grade_level: { name: string } | null } | null;
}

/**
 * Lists students for the current school, with optional name/admission search,
 * status filter, and current-year class filter. Each item includes the
 * student's class for the current academic year (if any).
 */
export async function listStudents(
  filters: StudentListFilters,
): Promise<StudentListItem[]> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();

  let query = supabase
    .from("students")
    .select(
      "id, admission_number, first_name, middle_name, last_name, gender, status",
    )
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  const search = filters.q?.replace(/[%,]/g, " ").trim();
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,admission_number.ilike.%${search}%`,
    );
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const { data: studentRows } = await query;
  const students = (studentRows as StudentRow[] | null) ?? [];

  const classByStudent = new Map<string, string>();
  let allowedIds: Set<string> | null = null;

  if (year?.id) {
    let enrolQuery = supabase
      .from("student_class_enrollments")
      .select("student_id, class:classes(name, grade_level:grade_levels(name))")
      .eq("academic_year_id", year.id);

    if (filters.classId) {
      enrolQuery = enrolQuery.eq("class_id", filters.classId);
      allowedIds = new Set<string>();
    }

    const { data: enrolments } = await enrolQuery;
    for (const row of (enrolments as EnrolmentClassRow[] | null) ?? []) {
      const name = row.class?.grade_level?.name ?? row.class?.name ?? null;
      if (name) {
        classByStudent.set(row.student_id, name);
      }
      if (allowedIds) {
        allowedIds.add(row.student_id);
      }
    }
  }

  return students
    .filter((student) => (allowedIds ? allowedIds.has(student.id) : true))
    .map((student) => ({
      id: student.id,
      admissionNumber: student.admission_number,
      fullName: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),
      gender: student.gender,
      status: student.status,
      className: classByStudent.get(student.id) ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Student profile
// ---------------------------------------------------------------------------

export interface StudentGuardianView {
  id: string;
  fullName: string;
  relationship: string;
  phone: string | null;
  altPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  nationalId: string | null;
  occupation: string | null;
  address: string | null;
  postalAddress: string | null;
  isPrimary: boolean;
  isEmergency: boolean;
}

export interface StudentEnrolmentView {
  id: string;
  className: string;
  academicYearName: string;
  status: string;
  enrolledOn: string;
  isCurrent: boolean;
}

export interface StudentProfile {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  status: string;
  enrollmentDate: string;
  placeOfBirth: string | null;
  religiousDenomination: string | null;
  previousSchool: string | null;
  proposedAdmissionDate: string | null;
  vaccinatedSmallpox: boolean | null;
  vaccinationDate: string | null;
  medicalNotes: string | null;
  isZambianCitizen: boolean | null;
  currentClassName: string | null;
  guardians: StudentGuardianView[];
  enrolments: StudentEnrolmentView[];
}

interface GuardianJoinRow {
  id: string;
  relationship: string;
  is_primary_contact: boolean;
  is_emergency_contact: boolean;
  guardian: {
    first_name: string;
    last_name: string;
    phone: string | null;
    alt_phone: string | null;
    whatsapp: string | null;
    email: string | null;
    national_id: string | null;
    occupation: string | null;
    address: string | null;
    postal_address: string | null;
  } | null;
}

interface EnrolmentJoinRow {
  id: string;
  status: string;
  enrolled_on: string;
  class: { name: string; grade_level: { name: string } | null } | null;
  academic_year: { name: string; is_current: boolean } | null;
}

export async function getStudentProfile(
  id: string,
): Promise<StudentProfile | null> {
  const supabase = await createSupabaseServerClient();

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, admission_number, first_name, middle_name, last_name, date_of_birth, gender, status, enrollment_date, place_of_birth, religious_denomination, previous_school, proposed_admission_date, vaccinated_smallpox, vaccination_date, medical_notes, is_zambian_citizen",
    )
    .eq("id", id)
    .maybeSingle();

  if (!student) {
    return null;
  }

  const { data: guardianRows } = await supabase
    .from("student_guardians")
    .select(
      "id, relationship, is_primary_contact, is_emergency_contact, guardian:guardians(first_name, last_name, phone, alt_phone, whatsapp, email, national_id, occupation, address, postal_address)",
    )
    .eq("student_id", id);

  const { data: enrolmentRows } = await supabase
    .from("student_class_enrollments")
    .select(
      "id, status, enrolled_on, class:classes(name, grade_level:grade_levels(name)), academic_year:academic_years(name, is_current)",
    )
    .eq("student_id", id)
    .order("enrolled_on", { ascending: false });

  const guardians: StudentGuardianView[] = (
    (guardianRows as GuardianJoinRow[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    fullName: [row.guardian?.first_name, row.guardian?.last_name]
      .filter(Boolean)
      .join(" "),
    relationship: row.relationship,
    phone: row.guardian?.phone ?? null,
    altPhone: row.guardian?.alt_phone ?? null,
    whatsapp: row.guardian?.whatsapp ?? null,
    email: row.guardian?.email ?? null,
    nationalId: row.guardian?.national_id ?? null,
    occupation: row.guardian?.occupation ?? null,
    address: row.guardian?.address ?? null,
    postalAddress: row.guardian?.postal_address ?? null,
    isPrimary: row.is_primary_contact,
    isEmergency: row.is_emergency_contact,
  }));

  guardians.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  const enrolments: StudentEnrolmentView[] = (
    (enrolmentRows as EnrolmentJoinRow[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    className: row.class?.grade_level?.name ?? row.class?.name ?? "-",
    academicYearName: row.academic_year?.name ?? "-",
    status: row.status,
    enrolledOn: row.enrolled_on,
    isCurrent: Boolean(row.academic_year?.is_current),
  }));

  const currentClassName =
    enrolments.find((enrolment) => enrolment.isCurrent)?.className ?? null;

  const student_ = student as StudentRow & {
    date_of_birth: string;
    enrollment_date: string;
    place_of_birth: string | null;
    religious_denomination: string | null;
    previous_school: string | null;
    proposed_admission_date: string | null;
    vaccinated_smallpox: boolean | null;
    vaccination_date: string | null;
    medical_notes: string | null;
    is_zambian_citizen: boolean | null;
  };

  return {
    id: student_.id,
    admissionNumber: student_.admission_number,
    firstName: student_.first_name,
    middleName: student_.middle_name,
    lastName: student_.last_name,
    fullName: [student_.first_name, student_.middle_name, student_.last_name]
      .filter(Boolean)
      .join(" "),
    dateOfBirth: student_.date_of_birth,
    gender: student_.gender,
    status: student_.status,
    enrollmentDate: student_.enrollment_date,
    placeOfBirth: student_.place_of_birth,
    religiousDenomination: student_.religious_denomination,
    previousSchool: student_.previous_school,
    proposedAdmissionDate: student_.proposed_admission_date,
    vaccinatedSmallpox: student_.vaccinated_smallpox,
    vaccinationDate: student_.vaccination_date,
    medicalNotes: student_.medical_notes,
    isZambianCitizen: student_.is_zambian_citizen,
    currentClassName,
    guardians,
    enrolments,
  };
}
