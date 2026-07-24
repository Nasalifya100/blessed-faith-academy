import { redirect } from "next/navigation";

import { ResultsDashboard } from "@/features/results/components/results-dashboard";
import {
  getClassTermResults,
  getResultsHubContext,
} from "@/features/results/queries";

export const dynamic = "force-dynamic";

export default async function AcademicResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hub = await getResultsHubContext();
  if (!hub) redirect("/dashboard");

  const params = await searchParams;
  const academicYearId =
    (typeof params.academic_year_id === "string"
      ? params.academic_year_id
      : null) ??
    hub.activeYearId ??
    hub.academicYears[0]?.id ??
    "";
  const termId =
    (typeof params.term_id === "string" ? params.term_id : null) ??
    hub.terms.find((t) => t.academic_year_id === academicYearId)?.id ??
    hub.activeTermId ??
    "";
  const classId =
    typeof params.class_id === "string" ? params.class_id : "";
  const subjectId =
    typeof params.subject_id === "string" ? params.subject_id : "";

  const bundle =
    academicYearId && termId && classId
      ? await getClassTermResults({
          academicYearId,
          termId,
          classId,
          subjectId: subjectId || null,
        })
      : null;

  return (
    <ResultsDashboard
      hub={hub}
      filters={{ academicYearId, termId, classId, subjectId }}
      bundle={bundle}
    />
  );
}
