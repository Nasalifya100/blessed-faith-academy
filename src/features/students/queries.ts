import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ClassOption {
  id: string;
  name: string;
  gradeName: string;
  sortOrder: number;
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
 * Gathers everything the "Add student" form needs: the classes available in
 * the current academic year (sorted by grade), and a suggested next admission
 * number. Returns empty/null pieces gracefully so the page can guide the user.
 */
export async function getEnrolmentFormData(): Promise<EnrolmentFormData> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  let classes: ClassOption[] = [];
  if (year?.id) {
    const { data: classRows } = await supabase
      .from("classes")
      .select("id, name, grade_level:grade_levels(name, sort_order)")
      .eq("academic_year_id", year.id)
      .eq("is_active", true);

    classes = ((classRows as ClassRow[] | null) ?? [])
      .map((row) => ({
        id: row.id,
        name: row.name,
        gradeName: row.grade_level?.name ?? row.name,
        sortOrder: row.grade_level?.sort_order ?? 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const { data: suggested } = await supabase.rpc("suggest_admission_number");

  return {
    academicYearName: year?.name ?? null,
    classes,
    suggestedAdmissionNumber:
      typeof suggested === "string" ? suggested : null,
  };
}
