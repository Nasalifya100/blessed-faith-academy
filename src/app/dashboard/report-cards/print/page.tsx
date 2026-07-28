import { redirect } from "next/navigation";

import { PrintButton } from "@/features/report-cards/components/report-card-actions";
import { ReportCardDocument } from "@/features/report-cards/components/report-card-document";
import {
  canOpenReportCards,
  canPrintReportCards,
} from "@/features/report-cards/permissions";
import { listClassReportCards } from "@/features/report-cards/queries";
import { getReportCardDetail } from "@/features/report-cards/queries";
import { getCurrentUser } from "@/features/auth/queries/current-user";

export const dynamic = "force-dynamic";

export default async function BulkReportCardsPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  if (
    !current?.profile ||
    !canOpenReportCards(current.profile.role) ||
    !canPrintReportCards(current.profile.role)
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const academicYearId =
    typeof params.academic_year_id === "string" ? params.academic_year_id : "";
  const termId = typeof params.term_id === "string" ? params.term_id : "";
  const classId = typeof params.class_id === "string" ? params.class_id : "";
  if (!academicYearId || !termId || !classId) {
    redirect("/dashboard/report-cards");
  }

  const cards = await listClassReportCards({
    academicYearId,
    termId,
    classId,
  });
  const printable = (cards ?? [])
    .filter(
      (c) =>
        c.has_render_payload &&
        ["APPROVED", "PUBLISHED", "UNPUBLISHED"].includes(c.status),
    )
    .slice()
    .sort((a, b) =>
      a.student_name.localeCompare(b.student_name, undefined, {
        sensitivity: "base",
      }),
    );

  const documents = [];
  for (const card of printable) {
    const detail = await getReportCardDetail(card.id);
    if (detail?.card.render_payload) {
      documents.push({
        id: card.id,
        status: card.status,
        payload: detail.card.render_payload,
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden space-y-2">
        <PrintButton />
        <p className="text-sm text-muted-foreground">
          Printing {documents.length} approved/published card(s). Draft-only
          cards are excluded.
        </p>
      </div>
      {documents.map((doc, index) => (
        <div
          key={doc.id}
          className={index < documents.length - 1 ? "break-after-page" : undefined}
        >
          <ReportCardDocument
            payload={doc.payload}
            statusLabel={doc.status}
            showDraftWatermark={false}
          />
        </div>
      ))}
    </div>
  );
}
