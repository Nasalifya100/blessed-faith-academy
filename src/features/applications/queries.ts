import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ApplicationListItem {
  id: string;
  applicantName: string;
  admissionNumber: string;
  appliedClassName: string | null;
  status: string;
  submittedAt: string | null;
}

interface ApplicationListRow {
  id: string;
  status: string;
  submitted_at: string | null;
  student: {
    first_name: string;
    middle_name: string | null;
    last_name: string;
    admission_number: string;
  } | null;
  applied_class: { name: string; grade_level: { name: string } | null } | null;
}

export async function listApplications(
  status?: string,
): Promise<ApplicationListItem[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("applications")
    .select(
      "id, status, submitted_at, student:students(first_name, middle_name, last_name, admission_number), applied_class:classes(name, grade_level:grade_levels(name))",
    )
    .order("submitted_at", { ascending: false, nullsFirst: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data } = await query;

  return ((data as ApplicationListRow[] | null) ?? []).map((row) => ({
    id: row.id,
    applicantName: [
      row.student?.first_name,
      row.student?.middle_name,
      row.student?.last_name,
    ]
      .filter(Boolean)
      .join(" "),
    admissionNumber: row.student?.admission_number ?? "-",
    appliedClassName:
      row.applied_class?.grade_level?.name ?? row.applied_class?.name ?? null,
    status: row.status,
    submittedAt: row.submitted_at,
  }));
}

export interface ApplicationGuardianView {
  id: string;
  fullName: string;
  relationship: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  isPrimary: boolean;
  isEmergency: boolean;
}

export interface ApplicationDetail {
  id: string;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionNotes: string | null;
  consentAgreed: boolean;
  consentSignedBy: string | null;
  consentSignedAt: string | null;
  emergencyContactPhone: string | null;
  mediaReleaseAgreed: boolean;
  submittedByName: string | null;
  reviewedByName: string | null;
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    dateOfBirth: string;
    gender: string;
    status: string;
    placeOfBirth: string | null;
    religiousDenomination: string | null;
    previousSchool: string | null;
    proposedAdmissionDate: string | null;
    vaccinatedSmallpox: boolean | null;
    vaccinationDate: string | null;
    medicalNotes: string | null;
    isZambianCitizen: boolean | null;
  } | null;
  appliedClass: { id: string; name: string } | null;
  guardians: ApplicationGuardianView[];
}

interface ApplicationDetailRow {
  id: string;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  decision_notes: string | null;
  consent_agreed: boolean;
  consent_signed_by: string | null;
  consent_signed_at: string | null;
  emergency_contact_phone: string | null;
  media_release_agreed: boolean;
  submitted_by: string | null;
  reviewed_by: string | null;
  student: {
    id: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    admission_number: string;
    date_of_birth: string;
    gender: string;
    status: string;
    place_of_birth: string | null;
    religious_denomination: string | null;
    previous_school: string | null;
    proposed_admission_date: string | null;
    vaccinated_smallpox: boolean | null;
    vaccination_date: string | null;
    medical_notes: string | null;
    is_zambian_citizen: boolean | null;
  } | null;
  applied_class: {
    id: string;
    name: string;
    grade_level: { name: string } | null;
  } | null;
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
    whatsapp: string | null;
    email: string | null;
  } | null;
}

export async function getApplicationDetail(
  id: string,
): Promise<ApplicationDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("applications")
    .select(
      "id, status, submitted_at, reviewed_at, decision_notes, consent_agreed, consent_signed_by, consent_signed_at, emergency_contact_phone, media_release_agreed, submitted_by, reviewed_by, student:students(id, first_name, middle_name, last_name, admission_number, date_of_birth, gender, status, place_of_birth, religious_denomination, previous_school, proposed_admission_date, vaccinated_smallpox, vaccination_date, medical_notes, is_zambian_citizen), applied_class:classes(id, name, grade_level:grade_levels(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return null;
  }

  const application = row as unknown as ApplicationDetailRow;

  const { data: guardianRows } = await supabase
    .from("student_guardians")
    .select(
      "id, relationship, is_primary_contact, is_emergency_contact, guardian:guardians(first_name, last_name, phone, whatsapp, email)",
    )
    .eq("student_id", application.student?.id ?? "");

  const profileIds = [
    application.submitted_by,
    application.reviewed_by,
  ].filter((value): value is string => Boolean(value));

  const nameById = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds);
    for (const profile of (profiles as { id: string; full_name: string }[] | null) ??
      []) {
      nameById.set(profile.id, profile.full_name);
    }
  }

  const guardians: ApplicationGuardianView[] = (
    (guardianRows as GuardianJoinRow[] | null) ?? []
  )
    .map((guardianRow) => ({
      id: guardianRow.id,
      fullName: [
        guardianRow.guardian?.first_name,
        guardianRow.guardian?.last_name,
      ]
        .filter(Boolean)
        .join(" "),
      relationship: guardianRow.relationship,
      phone: guardianRow.guardian?.phone ?? null,
      whatsapp: guardianRow.guardian?.whatsapp ?? null,
      email: guardianRow.guardian?.email ?? null,
      isPrimary: guardianRow.is_primary_contact,
      isEmergency: guardianRow.is_emergency_contact,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  return {
    id: application.id,
    status: application.status,
    submittedAt: application.submitted_at,
    reviewedAt: application.reviewed_at,
    decisionNotes: application.decision_notes,
    consentAgreed: application.consent_agreed,
    consentSignedBy: application.consent_signed_by,
    consentSignedAt: application.consent_signed_at,
    emergencyContactPhone: application.emergency_contact_phone,
    mediaReleaseAgreed: application.media_release_agreed,
    submittedByName: application.submitted_by
      ? (nameById.get(application.submitted_by) ?? null)
      : null,
    reviewedByName: application.reviewed_by
      ? (nameById.get(application.reviewed_by) ?? null)
      : null,
    student: application.student
      ? {
          id: application.student.id,
          fullName: [
            application.student.first_name,
            application.student.middle_name,
            application.student.last_name,
          ]
            .filter(Boolean)
            .join(" "),
          admissionNumber: application.student.admission_number,
          dateOfBirth: application.student.date_of_birth,
          gender: application.student.gender,
          status: application.student.status,
          placeOfBirth: application.student.place_of_birth,
          religiousDenomination: application.student.religious_denomination,
          previousSchool: application.student.previous_school,
          proposedAdmissionDate: application.student.proposed_admission_date,
          vaccinatedSmallpox: application.student.vaccinated_smallpox,
          vaccinationDate: application.student.vaccination_date,
          medicalNotes: application.student.medical_notes,
          isZambianCitizen: application.student.is_zambian_citizen,
        }
      : null,
    appliedClass: application.applied_class
      ? {
          id: application.applied_class.id,
          name:
            application.applied_class.grade_level?.name ??
            application.applied_class.name,
        }
      : null,
    guardians,
  };
}
