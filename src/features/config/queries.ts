import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  TermOption,
  YearOption,
} from "@/features/config/components/set-current-period-panel";

export async function listAcademicYearsAndTerms(): Promise<{
  years: YearOption[];
  terms: TermOption[];
}> {
  const supabase = await createSupabaseServerClient();

  const { data: yearRows } = await supabase
    .from("academic_years")
    .select("id, name, is_current")
    .order("start_date", { ascending: false });

  const years: YearOption[] = (
    (yearRows as { id: string; name: string; is_current: boolean }[] | null) ??
    []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    isCurrent: row.is_current,
  }));

  const { data: termRows } = await supabase
    .from("terms")
    .select("id, name, academic_year_id, is_current")
    .order("term_number", { ascending: true });

  const terms: TermOption[] = (
    (termRows as {
      id: string;
      name: string;
      academic_year_id: string;
      is_current: boolean;
    }[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    academicYearId: row.academic_year_id,
    isCurrent: row.is_current,
  }));

  return { years, terms };
}
