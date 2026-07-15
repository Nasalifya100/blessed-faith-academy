"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
}

export function ReviewActions({
  applicationId,
  classes,
  defaultClassId,
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-2">
        <Label htmlFor="approve_class">Enrol into class</Label>
        <SelectNative
          id="approve_class"
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          className="w-56"
        >
          {classes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.gradeName}
            </option>
          ))}
        </SelectNative>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={approve} disabled={isPending || !classId}>
          {isPending ? "Working..." : "Approve & enrol"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowReject((value) => !value)}
          disabled={isPending}
        >
          Reject
        </Button>
      </div>

      {showReject ? (
        <div className="space-y-2 rounded-lg border p-4">
          <Label htmlFor="reject_notes">Reason (required)</Label>
          <textarea
            id="reject_notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <Button
            variant="destructive"
            onClick={reject}
            disabled={isPending || notes.trim().length < 3}
          >
            {isPending ? "Working..." : "Confirm rejection"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
