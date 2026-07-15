"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { archiveStudentAction } from "@/features/students/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ArchiveStudentButtonProps {
  studentId: string;
  studentName: string;
}

export function ArchiveStudentButton({
  studentId,
  studentName,
}: ArchiveStudentButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await archiveStudentAction({
        studentId,
        reason,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Archive student
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm">
        Archive <span className="font-medium">{studentName}</span>? The record
        stays on file as withdrawn (not deleted).
      </p>
      <div className="space-y-1">
        <Label htmlFor="archive-reason">Reason (optional)</Label>
        <Input
          id="archive-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={isPending}
          placeholder="e.g. Transferred to another school"
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={onConfirm}
        >
          {isPending ? "Archiving…" : "Confirm archive"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
