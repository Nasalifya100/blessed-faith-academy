import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  PrintButton,
  RemarksForm,
  ReportCardLifecycleButtons,
} from "@/features/report-cards/components/report-card-actions";
import { ReportCardDocument } from "@/features/report-cards/components/report-card-document";
import {
  canApproveReportCards,
  canEditReportCardRemarks,
  canOpenReportCards,
  canPrintReportCards,
  canPublishReportCards,
  canReviewReportCards,
} from "@/features/report-cards/permissions";
import { getReportCardDetail } from "@/features/report-cards/queries";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReportCardDetailPage({
  params,
}: {
  params: Promise<{ reportCardId: string }>;
}) {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenReportCards(current.profile.role)) {
    redirect("/dashboard");
  }

  const { reportCardId } = await params;
  const detail = await getReportCardDetail(reportCardId);
  if (!detail) notFound();

  const { card, events } = detail;
  const role = current.profile.role;
  const canEditTeacher = canEditReportCardRemarks(role);
  const canEditHead =
    canApproveReportCards(role) || canPublishReportCards(role);
  const remarksLocked = ["APPROVED", "PUBLISHED", "VOIDED"].includes(
    card.status,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {card.student_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Status {card.status}
            {card.source_is_outdated ? " · outdated source" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/report-cards"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Back
          </Link>
          {canPrintReportCards(role) ? (
            <Link
              href={`/dashboard/report-cards/${card.id}/print`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Print view
            </Link>
          ) : null}
        </div>
      </div>

      {card.source_is_outdated ? (
        <div
          role="status"
          className="rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm print:hidden"
        >
          This draft is based on an older result calculation. Regenerate before
          approval or publication.
        </div>
      ) : null}

      <section className="space-y-3 print:hidden">
        <h2 className="text-lg font-medium">Workflow</h2>
        <ReportCardLifecycleButtons
          reportCardId={card.id}
          revision={card.revision}
          status={card.status}
          canReview={canReviewReportCards(role)}
          canApprove={canApproveReportCards(role)}
          canPublish={canPublishReportCards(role)}
        />
      </section>

      <section className="space-y-3 print:hidden">
        <h2 className="text-lg font-medium">Remarks</h2>
        <RemarksForm
          reportCardId={card.id}
          revision={card.revision}
          teacherRemark={card.teacher_remark}
          headteacherRemark={card.headteacher_remark}
          canEditTeacher={canEditTeacher}
          canEditHead={canEditHead}
          locked={remarksLocked}
        />
      </section>

      {card.render_payload ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between print:hidden">
            <h2 className="text-lg font-medium">Document preview</h2>
            <PrintButton />
          </div>
          <ReportCardDocument
            payload={card.render_payload}
            statusLabel={card.status}
            showDraftWatermark={!["PUBLISHED", "APPROVED", "UNPUBLISHED"].includes(card.status)}
          />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground print:hidden">
          Immutable document preview appears after approval.
        </p>
      )}

      <section className="space-y-2 print:hidden">
        <h2 className="text-lg font-medium">History</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {events.map((e) => (
            <li key={e.id}>
              {new Date(e.created_at).toLocaleString()} · {e.event_type}
              {e.from_status ? ` (${e.from_status} → ${e.to_status})` : ""}
              {e.reason ? ` — ${e.reason}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
