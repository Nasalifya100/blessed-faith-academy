"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateStudentChargesAction } from "@/features/fees/actions";
import { Button } from "@/components/ui/button";

interface GenerateStudentChargesButtonProps {
  studentId: string;
  termId: string | null;
  termName: string | null;
}

export function GenerateStudentChargesButton({
  studentId,
  termId,
  termName,
}: GenerateStudentChargesButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={isPending}>
        {isPending
          ? "Generating..."
          : `Generate charges${termName ? ` for ${termName}` : ""}`}
      </Button>
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
    </div>
  );
}
