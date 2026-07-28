import { redirect } from "next/navigation";

import { ReportCardsDashboard } from "@/features/report-cards/components/report-cards-dashboard";
import {
  getClassReportCardReadiness,
  getReportCardsHubContext,
  listClassReportCards,
} from "@/features/report-cards/queries";

export const dynamic = "force-dynamic";

export default async function ReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hub = await getReportCardsHubContext();
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

  const readiness =
    academicYearId && termId && classId
      ? await getClassReportCardReadiness({
          academicYearId,
          termId,
          classId,
        })
      : null;
  const cards =
    academicYearId && termId && classId
      ? await listClassReportCards({
          academicYearId,
          termId,
          classId,
        })
      : null;

  return (
    <ReportCardsDashboard
      hub={hub}
      filters={{ academicYearId, termId, classId }}
      readiness={readiness}
      cards={cards}
    />
  );
}
