"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  approveReportCardAction,
  generateClassReportCardDraftsAction,
  markReportCardReviewedAction,
  publishReportCardAction,
  saveReportCardRemarksAction,
  unpublishReportCardAction,
  voidReportCardAction,
} from "@/features/report-cards/actions";
import { Button } from "@/components/ui/button";

function useActionFeedback() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Action failed.");
        return;
      }
      setMessage(result.message ?? "Done.");
      router.refresh();
    });
  }

  return { pending, message, error, run };
}

export function GenerateDraftsButton(props: {
  academicYearId: string;
  termId: string;
  classId: string;
  disabled?: boolean;
}) {
  const { pending, message, error, run } = useActionFeedback();
  return (
    <div className="space-y-1">
      <Button
        type="button"
        disabled={
          pending ||
          props.disabled ||
          !props.academicYearId ||
          !props.termId ||
          !props.classId
        }
        onClick={() =>
          run(() =>
            generateClassReportCardDraftsAction({
              academic_year_id: props.academicYearId,
              term_id: props.termId,
              class_id: props.classId,
            }),
          )
        }
      >
        {pending ? "Generating…" : "Generate drafts"}
      </Button>
      {message ? (
        <p className="text-sm text-emerald-700" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReportCardLifecycleButtons(props: {
  reportCardId: string;
  revision: number;
  status: string;
  canReview: boolean;
  canApprove: boolean;
  canPublish: boolean;
}) {
  const { pending, message, error, run } = useActionFeedback();
  const id = props.reportCardId;
  const rev = props.revision;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {props.canReview && props.status === "DRAFT" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                markReportCardReviewedAction({
                  report_card_id: id,
                  expected_revision: rev,
                }),
              )
            }
          >
            Mark reviewed
          </Button>
        ) : null}
        {props.canApprove &&
        ["DRAFT", "REVIEWED", "UNPUBLISHED"].includes(props.status) ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                approveReportCardAction({
                  report_card_id: id,
                  expected_revision: rev,
                }),
              )
            }
          >
            Approve
          </Button>
        ) : null}
        {props.canPublish &&
        ["APPROVED", "UNPUBLISHED"].includes(props.status) ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                publishReportCardAction({
                  report_card_id: id,
                  expected_revision: rev,
                }),
              )
            }
          >
            Publish
          </Button>
        ) : null}
        {props.canPublish && props.status === "PUBLISHED" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                unpublishReportCardAction({
                  report_card_id: id,
                  expected_revision: rev,
                  reason: "Unpublished for correction",
                }),
              )
            }
          >
            Unpublish
          </Button>
        ) : null}
        {(props.canApprove || props.canPublish) &&
        props.status !== "VOIDED" &&
        props.status !== "PUBLISHED" ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              const reason = window.prompt("Void reason (required):");
              if (!reason || reason.trim().length < 3) return;
              run(() =>
                voidReportCardAction({
                  report_card_id: id,
                  expected_revision: rev,
                  reason: reason.trim(),
                }),
              );
            }}
          >
            Void
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="text-sm text-emerald-700" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RemarksForm(props: {
  reportCardId: string;
  revision: number;
  teacherRemark: string | null;
  headteacherRemark: string | null;
  canEditTeacher: boolean;
  canEditHead: boolean;
  locked: boolean;
}) {
  const { pending, message, error, run } = useActionFeedback();
  const [teacher, setTeacher] = useState(props.teacherRemark ?? "");
  const [head, setHead] = useState(props.headteacherRemark ?? "");

  if (props.locked) {
    return (
      <p className="text-sm text-muted-foreground">
        Remarks are locked for the current status.
      </p>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveReportCardRemarksAction({
            report_card_id: props.reportCardId,
            expected_revision: props.revision,
            teacher_remark: teacher,
            headteacher_remark: head,
            update_teacher: props.canEditTeacher,
            update_headteacher: props.canEditHead,
          }),
        );
      }}
    >
      {props.canEditTeacher ? (
        <label className="grid gap-1 text-sm" htmlFor="rc-teacher-remark">
          <span>Class teacher remark</span>
          <textarea
            id="rc-teacher-remark"
            className="min-h-20 rounded-md border bg-background px-3 py-2"
            maxLength={2000}
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
          />
        </label>
      ) : null}
      {props.canEditHead ? (
        <label className="grid gap-1 text-sm" htmlFor="rc-head-remark">
          <span>Head teacher remark</span>
          <textarea
            id="rc-head-remark"
            className="min-h-20 rounded-md border bg-background px-3 py-2"
            maxLength={2000}
            value={head}
            onChange={(e) => setHead(e.target.value)}
          />
        </label>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save remarks"}
      </Button>
      {message ? (
        <p className="text-sm text-emerald-700" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      Print / Save PDF
    </Button>
  );
}
