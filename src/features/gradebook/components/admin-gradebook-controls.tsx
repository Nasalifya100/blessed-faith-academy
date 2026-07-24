"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  lockExamGradebookAction,
  reopenExamGradebookAction,
} from "@/features/gradebook/actions";
import { LOCK_CONFIRMATION_TEXT } from "@/features/gradebook/entry-logic";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ReopenGradebookControls({
  gradebookId,
  expectedRevision,
  canReopen,
}: {
  gradebookId: string;
  expectedRevision: number;
  canReopen: boolean;
}) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canReopen) return null;

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await reopenExamGradebookAction({
        gradebook_id: gradebookId,
        expected_revision: expectedRevision,
        reason,
      });
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => setOpen(true)}
      >
        Reopen gradebook
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${reasonId}-title`}
            className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-lg"
          >
            <h2
              id={`${reasonId}-title`}
              className="text-lg font-semibold tracking-tight"
            >
              Reopen submitted gradebook
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Reopening allows authorised marks changes. Provide a clear reason
              for the audit trail. Uses revision {expectedRevision}.
            </p>
            <label className="mt-4 block space-y-1 text-sm" htmlFor={reasonId}>
              <span className="font-medium">Reason</span>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border bg-background px-3 py-2"
                placeholder="e.g. Moderation correction required"
              />
            </label>
            {error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={pending || reason.trim().length < 3}
                onClick={confirm}
              >
                {pending ? "Reopening…" : "Reopen"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function LockGradebookControls({
  gradebookId,
  expectedRevision,
  canLock,
}: {
  gradebookId: string;
  expectedRevision: number;
  canLock: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canLock) return null;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="min-h-11"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        Lock gradebook
      </Button>
      <ConfirmDialog
        open={open}
        title="Lock this gradebook?"
        description={`${LOCK_CONFIRMATION_TEXT} Uses revision ${expectedRevision}.`}
        confirmLabel="Lock permanently"
        tone="danger"
        pending={pending}
        onCancel={() => {
          if (!pending) setOpen(false);
        }}
        onConfirm={() => {
          if (pending) return;
          setError(null);
          startTransition(async () => {
            const result = await lockExamGradebookAction({
              gradebook_id: gradebookId,
              expected_revision: expectedRevision,
            });
            if (result.error !== null) {
              setError(result.error);
              setOpen(false);
              return;
            }
            setOpen(false);
            router.refresh();
          });
        }}
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
