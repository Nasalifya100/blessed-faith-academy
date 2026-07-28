import { notFound, redirect } from "next/navigation";

import { PrintButton } from "@/features/report-cards/components/report-card-actions";
import { ReportCardDocument } from "@/features/report-cards/components/report-card-document";
import {
  canOpenReportCards,
  canPrintReportCards,
} from "@/features/report-cards/permissions";
import { getReportCardDetail } from "@/features/report-cards/queries";
import { getCurrentUser } from "@/features/auth/queries/current-user";

export const dynamic = "force-dynamic";

export default async function ReportCardPrintPage({
  params,
}: {
  params: Promise<{ reportCardId: string }>;
}) {
  const current = await getCurrentUser();
  if (
    !current?.profile ||
    !canOpenReportCards(current.profile.role) ||
    !canPrintReportCards(current.profile.role)
  ) {
    redirect("/dashboard");
  }

  const { reportCardId } = await params;
  const detail = await getReportCardDetail(reportCardId);
  if (!detail?.card.render_payload) notFound();

  const payload = detail.card.render_payload;
  const showDraft =
    !["PUBLISHED", "APPROVED", "UNPUBLISHED"].includes(detail.card.status);

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PrintButton />
      </div>
      <ReportCardDocument
        payload={payload}
        statusLabel={detail.card.status}
        showDraftWatermark={showDraft}
      />
    </div>
  );
}
