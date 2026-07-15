"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { transferStudentClassAction } from "@/features/students/actions";
import type { ClassOption } from "@/features/students/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface TransferStudentClassFormProps {
  studentId: string;
  studentName: string;
  currentClassId: string | null;
  classes: ClassOption[];
}

export function TransferStudentClassForm({
  studentId,
  studentName,
  currentClassId,
  classes,
}: TransferStudentClassFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const targets = classes.filter((option) => option.id !== currentClassId);
  const [newClassId, setNewClassId] = useState(targets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (targets.length === 0) {
    return null;
  }

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await transferStudentClassAction({
        studentId,
        newClassId,
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
        Transfer class
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm">
        Move <span className="font-medium">{studentName}</span> to another class
        in the current academic year. The previous placement stays on file as
        transferred.
      </p>
      <div className="space-y-1">
        <Label htmlFor="transfer-class">New class</Label>
        <SelectNative
          id="transfer-class"
          value={newClassId}
          onChange={(event) => setNewClassId(event.target.value)}
          disabled={isPending}
        >
          {targets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.gradeName}
            </option>
          ))}
        </SelectNative>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={isPending || !newClassId}
          onClick={onConfirm}
        >
          {isPending ? "Transferring…" : "Confirm transfer"}
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
