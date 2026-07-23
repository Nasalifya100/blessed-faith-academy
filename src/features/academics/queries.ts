import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasAcademicCapability } from "@/features/academics/permissions";

export type AcademicSetupChecklist = {
  hasCurrentYear: boolean;
  hasTerms: boolean;
  hasClasses: boolean;
  hasSubjects: boolean;
  hasOfferings: boolean;
  hasTeachingAssignments: boolean;
  gradingConfirmed: boolean;
  weightsConfirmed: boolean;
};

export async function getAcademicSetupChecklist(): Promise<AcademicSetupChecklist> {
  const empty: AcademicSetupChecklist = {
    hasCurrentYear: false,
    hasTerms: false,
    hasClasses: false,
    hasSubjects: false,
    hasOfferings: false,
    hasTeachingAssignments: false,
    gradingConfirmed: false,
    weightsConfirmed: false,
  };

  const current = await getCurrentUser();
  if (
    !current?.profile ||
    !hasAcademicCapability(current.profile.role, "ACADEMIC_CONFIGURATION_VIEW")
  ) {
    return empty;
  }

  const supabase = await createSupabaseServerClient();
  const schoolId = current.profile.school_id;
  if (!schoolId) return empty;

  const [
    years,
    terms,
    classes,
    subjects,
    offerings,
    assignments,
    settings,
  ] = await Promise.all([
    supabase
      .from("academic_years")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("is_current", true),
    supabase
      .from("terms")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId),
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("is_active", true),
    supabase
      .from("subjects")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .is("archived_at", null),
    supabase
      .from("subject_offerings")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("is_active", true),
    supabase
      .from("teaching_assignments")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("is_active", true),
    supabase
      .from("academic_settings")
      .select("grading_scale_confirmed_at, weight_scheme_confirmed_at")
      .eq("school_id", schoolId)
      .maybeSingle(),
  ]);

  return {
    hasCurrentYear: (years.count ?? 0) > 0,
    hasTerms: (terms.count ?? 0) > 0,
    hasClasses: (classes.count ?? 0) > 0,
    hasSubjects: (subjects.count ?? 0) > 0,
    hasOfferings: (offerings.count ?? 0) > 0,
    hasTeachingAssignments: (assignments.count ?? 0) > 0,
    gradingConfirmed: Boolean(settings.data?.grading_scale_confirmed_at),
    weightsConfirmed: Boolean(settings.data?.weight_scheme_confirmed_at),
  };
}

export async function listSubjects(options?: {
  activeOnly?: boolean;
  search?: string;
}) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("subjects")
    .select(
      "id, name, short_name, code, subject_category, description, is_active, display_order, archived_at",
    )
    .is("archived_at", null)
    .order("display_order")
    .order("name");

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }
  if (options?.search?.trim()) {
    query = query.ilike("name", `%${options.search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listGradeLevels() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("grade_levels")
    .select("id, name, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listClassesForYear(academicYearId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("classes")
    .select(
      "id, name, stream_code, capacity, is_active, grade_level_id, academic_year_id, grade_levels(name, sort_order)",
    )
    .eq("academic_year_id", academicYearId)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listOfferingsForGrade(input: {
  academicYearId: string;
  gradeLevelId: string;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subject_offerings")
    .select(
      "id, subject_id, is_compulsory, is_active, offering_type, class_id, term_id, subjects(name, code)",
    )
    .eq("academic_year_id", input.academicYearId)
    .eq("grade_level_id", input.gradeLevelId)
    .eq("is_active", true)
    .is("class_id", null)
    .is("term_id", null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listActiveOfferings(academicYearId?: string) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("subject_offerings")
    .select(
      "id, subject_id, grade_level_id, class_id, is_compulsory, subjects(name), grade_levels(name), classes(name)",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (academicYearId) {
    query = query.eq("academic_year_id", academicYearId);
  }
  const { data, error } = await query.limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listTeachingAssignments(academicYearId?: string) {
  const supabase = await createSupabaseServerClient();
  const query = supabase
    .from("teaching_assignments")
    .select(
      "id, staff_id, subject_offering_id, class_id, role_type, is_primary, is_active, effective_from, effective_to, profiles(full_name), subject_offerings(subjects(name), grade_levels(name), academic_year_id)",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(200);
  const { data, error } = await query;

  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!academicYearId) return rows;
  return rows.filter((row) => {
    const offering = row.subject_offerings as
      | { academic_year_id?: string }
      | null;
    return offering?.academic_year_id === academicYearId;
  });
}

export async function getDefaultGradingScheme() {
  const supabase = await createSupabaseServerClient();
  const { data: scheme, error } = await supabase
    .from("grading_schemes")
    .select("id, name, is_default, is_active, version")
    .eq("is_default", true)
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scheme) return null;
  const { data: bands, error: bandError } = await supabase
    .from("grading_scheme_bands")
    .select(
      "id, minimum_score, maximum_score, grade_code, grade_label, grade_point, is_pass, display_order",
    )
    .eq("grading_scheme_id", scheme.id)
    .order("display_order");
  if (bandError) throw new Error(bandError.message);
  return { ...scheme, bands: bands ?? [] };
}

export async function listAssessmentTypes() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assessment_types")
    .select(
      "id, name, code, category, default_maximum_mark, is_exam, is_active, display_order",
    )
    .eq("is_active", true)
    .order("display_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getDefaultWeightScheme() {
  const supabase = await createSupabaseServerClient();
  const { data: scheme, error } = await supabase
    .from("assessment_weight_schemes")
    .select("id, name, is_default, is_active")
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scheme) return null;
  const { data: items, error: itemError } = await supabase
    .from("assessment_weight_items")
    .select(
      "id, assessment_type_id, weight_percentage, display_order, assessment_types(name)",
    )
    .eq("scheme_id", scheme.id)
    .order("display_order");
  if (itemError) throw new Error(itemError.message);
  return { ...scheme, items: items ?? [] };
}

export async function listWorkflowPeriods(academicYearId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("academic_workflow_periods")
    .select(
      "id, workflow_type, starts_at, ends_at, notes, term_id, is_active, terms(name)",
    )
    .eq("academic_year_id", academicYearId)
    .eq("is_active", true)
    .order("starts_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}
