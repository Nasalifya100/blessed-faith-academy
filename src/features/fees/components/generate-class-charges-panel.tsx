"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateClassChargesAction } from "@/features/fees/actions";
import type { ClassOption } from "@/features/students/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface GenerateClassChargesPanelProps {
  classes: ClassOption[];
  termId: string | null;
  termName: string | null;
}

export function GenerateClassChargesPanel({
  classes,
  termId,
  termName,
}: GenerateClassChargesPanelProps) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (classes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No classes are set up for the current academic year yet.
      </p>
    );
  }

  function handleGenerate() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await generateClassChargesAction({
        classId,
        termId: termId ?? undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(
        result.createdCount === 0
          ? "No new charges — every enrolled pupil in that class already has the mandatory fees for this period."
          : `Created ${result.createdCount} charge${result.createdCount === 1 ? "" : "s"} for the class.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="charge-class">Class</Label>
          <SelectNative
            id="charge-class"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            disabled={isPending}
          >
            {classes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.gradeName}
              </option>
            ))}
          </SelectNative>
        </div>
        <Button
          type="button"
          disabled={isPending || !classId}
          onClick={handleGenerate}
        >
          {isPending
            ? "Generating…"
            : `Generate class charges${termName ? ` (${termName})` : ""}`}
        </Button>
      </div>
      {message ? (
        <p className="text-sm text-emerald-600" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Creates missing mandatory tuition and extra fees for every actively
        enrolled pupil in the class. Skips charges that already exist.
      </p>
    </div>
  );
}
