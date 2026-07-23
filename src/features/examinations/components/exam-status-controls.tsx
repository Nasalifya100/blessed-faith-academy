"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { transitionExamStatusAction } from "@/features/examinations/actions";
import {
  EXAM_LIFECYCLE_HELP,
  EXAM_LIFECYCLE_STATUS_LABELS,
  EXAM_LIFECYCLE_STATUSES,
} from "@/features/examinations/schemas";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Lifecycle = (typeof EXAM_LIFECYCLE_STATUSES)[number];

const TONE: Record<Lifecycle, StatusTone> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  READY: "success",
  COMPLETED: "warning",
  ARCHIVED: "neutral",
};

const FORWARD: Partial<Record<Lifecycle, Lifecycle>> = {
  DRAFT: "SCHEDULED",
  SCHEDULED: "READY",
  READY: "COMPLETED",
  COMPLETED: "ARCHIVED",
};

const BACK: Partial<Record<Lifecycle, Lifecycle>> = {
  SCHEDULED: "DRAFT",
  READY: "SCHEDULED",
  COMPLETED: "READY",
  ARCHIVED: "COMPLETED",
};

const ACTION_LABEL: Partial<Record<Lifecycle, string>> = {
  SCHEDULED: "Mark as Scheduled",
  READY: "Mark as Ready",
  COMPLETED: "Mark as Completed",
  ARCHIVED: "Archive",
  DRAFT: "Return to Draft",
};

export function ExamStatusBadge({ status }: { status: Lifecycle | string }) {
  const key = status as Lifecycle;
  const label = EXAM_LIFECYCLE_STATUS_LABELS[key] ?? status;
  return <StatusBadge tone={TONE[key] ?? "neutral"}>{label}</StatusBadge>;
}

export function ExamStatusActions({
  examId,
  status,
  periodId,
}: {
  examId: string;
  status: Lifecycle;
  periodId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<
    { code: string; label: string; href_hint?: string }[]
  >([]);
  const [reason, setReason] = useState("");
  const [forceFuture, setForceFuture] = useState(false);

  const forward = FORWARD[status];
  const back = BACK[status];
  const needsReason =
    status === "READY" || status === "COMPLETED" || status === "ARCHIVED";

  function run(next: Lifecycle, withReason: boolean) {
    setError(null);
    setMissing([]);
    start(async () => {
      const result = await transitionExamStatusAction({
        exam_id: examId,
        new_status: next,
        reason: withReason ? reason || null : null,
        force_future_complete: forceFuture,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.missing?.length) {
        setError(result.message ?? "Cannot change status yet.");
        setMissing(result.missing);
        return;
      }
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ExamStatusBadge status={status} />
        <p className="text-sm text-muted-foreground">
          {EXAM_LIFECYCLE_HELP[status]}
        </p>
      </div>

      {needsReason || back ? (
        <div className="space-y-1">
          <Label htmlFor={`reason-${examId}`}>
            Reason (required when moving backward from Ready or later)
          </Label>
          <Input
            id={`reason-${examId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Short reason"
          />
        </div>
      ) : null}

      {status === "READY" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={forceFuture}
            onChange={(e) => setForceFuture(e.target.checked)}
          />
          Allow complete even if the exam date is still more than a day away
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {forward ? (
          <Button
            type="button"
            className="h-11"
            disabled={pending}
            onClick={() => run(forward, false)}
          >
            {ACTION_LABEL[forward] ?? `Mark as ${forward}`}
          </Button>
        ) : null}
        {back ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={pending || (needsReason && !reason.trim())}
            onClick={() => run(back, true)}
          >
            {back === "DRAFT"
              ? "Return to Draft"
              : back === "SCHEDULED"
                ? "Return to Scheduled"
                : back === "READY"
                  ? "Return to Ready"
                  : back === "COMPLETED"
                    ? "Reopen to Completed"
                    : "Go back"}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {missing.length > 0 ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Still needed:</p>
          <ul className="list-disc space-y-1 pl-5">
            {missing.map((item) => (
              <li key={item.code}>
                {item.label}
                {item.href_hint === "schedule" ? (
                  <>
                    {" "}
                    <Link
                      className="underline"
                      href={`/dashboard/examinations/periods/${periodId}/schedule`}
                    >
                      Open schedule
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
