"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import {
  approveApplicationAction,
  rejectApplicationAction,
} from "@/features/applications/actions";
import type { ClassOption } from "@/features/students/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface ReviewActionsProps {
  applicationId: string;
  classes: ClassOption[];
  defaultClassId: string | null;
  missingItems?: string[];
}

export function ReviewActions({
  applicationId,
  classes,
  defaultClassId,
  missingItems = [],
}: ReviewActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [classId, setClassId] = useState(
    defaultClassId ?? classes[0]?.id ?? "",
  );
  const [showReject, setShowReject] = useState(false);
  const [notes, setNotes] = useState("");

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveApplicationAction({
        applicationId,
        class_id: classId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectApplicationAction({ applicationId, notes });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {missingItems.length > 0 ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            Required items missing
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {missingItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-xs opacity-90">
            Existing validation still applies — resolve issues before approving
            if the server rejects the decision.
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Checklist looks complete on this record.
        </p>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="approve_class">Enrol into class</Label>
        <SelectNative
          id="approve_class"
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          className="w-full"
          aria-label="Class to enrol applicant into"
        >
          {classes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.gradeName}
            </option>
          ))}
        </SelectNative>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          onClick={approve}
          disabled={isPending || !classId}
          className="w-full gap-2"
          size="lg"
        >
          <CheckCircle2 className="size-4" aria-hidden />
          {isPending ? "Working…" : "Approve & enrol"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowReject((value) => !value)}
          disabled={isPending}
          className="w-full gap-2"
          size="lg"
          aria-expanded={showReject}
        >
          <XCircle className="size-4" aria-hidden />
          {showReject ? "Cancel rejection" : "Reject application"}
        </Button>
      </div>

      {showReject ? (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <Label htmlFor="reject_notes">
            Reason <span className="text-destructive">*</span>
          </Label>
          <textarea
            id="reject_notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            required
            aria-required="true"
            placeholder="Explain why this application is being rejected"
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <Button
            variant="destructive"
            onClick={reject}
            disabled={isPending || notes.trim().length < 3}
            className="w-full"
          >
            {isPending ? "Working…" : "Confirm rejection"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
