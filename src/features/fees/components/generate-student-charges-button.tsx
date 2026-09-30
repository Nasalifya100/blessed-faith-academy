"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { generateStudentChargesAction } from "@/features/fees/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface GenerateStudentChargesButtonProps {
  studentId: string;
  academicYearName: string | null;
  termId: string | null;
  termName: string | null;
  mandatoryFeeNames?: string[];
}

export function GenerateStudentChargesButton({
  studentId,
  academicYearName,
  termId,
  termName,
  mandatoryFeeNames = [],
}: GenerateStudentChargesButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await generateStudentChargesAction({
        studentId,
        termId: termId ?? undefined,
      });
      setConfirmOpen(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(
        result.createdCount === 0
          ? "No new charges — this student already has the mandatory fees for this period."
          : `Created ${result.createdCount} charge${result.createdCount === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Generate charges</CardTitle>
        <CardDescription>
          Apply mandatory fee items for{" "}
          {academicYearName ?? "the current academic year"}
          {termName ? `, ${termName}` : ", current term"}. Uniforms, meals, and
          tuck shop are not included.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => {
            setMessage(null);
            setError(null);
            setConfirmOpen(true);
          }}
          disabled={isPending}
          variant="outline"
          className="gap-1.5"
        >
          <Sparkles className="size-4" aria-hidden />
          {isPending
            ? "Generating…"
            : `Generate charges${termName ? ` for ${termName}` : ""}`}
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          title="Generate charges"
          description={[
            `Academic year: ${academicYearName ?? "current academic year"}.`,
            `Term: ${termName ?? "current term"}.`,
            mandatoryFeeNames.length > 0
              ? `Charges: ${mandatoryFeeNames.join("; ")}.`
              : "Mandatory school fees for this pupil.",
            "Amounts follow this pupil's grade on the fee schedule.",
            "Meals, uniforms, and tuck shop are not included.",
            "Charges that already exist are skipped.",
          ].join(" ")}
          confirmLabel="Generate charges"
          pending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleClick}
        />
        {message ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
