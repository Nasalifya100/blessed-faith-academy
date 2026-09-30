"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateClassChargesAction } from "@/features/fees/actions";
import type { ClassOption } from "@/features/students/queries";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface GenerateClassChargesPanelProps {
  classes: ClassOption[];
  academicYearName: string | null;
  termId: string | null;
  termName: string | null;
  mandatoryFeeNames: string[];
}

export function GenerateClassChargesPanel({
  classes,
  academicYearName,
  termId,
  termName,
  mandatoryFeeNames,
}: GenerateClassChargesPanelProps) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = classes.find((option) => option.id === classId) ?? null;

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
      setConfirmOpen(false);
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
          onClick={() => {
            setMessage(null);
            setError(null);
            setConfirmOpen(true);
          }}
        >
          {isPending
            ? "Generating…"
            : `Generate class charges${termName ? ` (${termName})` : ""}`}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Generate charges"
        description={[
          `Academic year: ${academicYearName ?? "current academic year"}.`,
          `Term: ${termName ?? "current term"}.`,
          `Class: ${selected?.gradeName ?? "selected class"}.`,
          mandatoryFeeNames.length > 0
            ? `Mandatory charges: ${mandatoryFeeNames.join(", ")}.`
            : "Mandatory charges come from the fee schedule for each pupil's grade.",
          "Amounts follow each pupil's grade on the fee schedule.",
          "Meals, uniforms, and tuck shop are not included.",
          "Pupils who already have these charges for this period are skipped.",
        ].join(" ")}
        confirmLabel="Generate charges"
        pending={isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleGenerate}
      />
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
