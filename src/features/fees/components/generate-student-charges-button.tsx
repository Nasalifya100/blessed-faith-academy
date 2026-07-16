"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { generateStudentChargesAction } from "@/features/fees/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Generate charges</CardTitle>
        <CardDescription>
          Apply mandatory fee items
          {termName ? ` for ${termName}` : " for the current term"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={handleClick}
          disabled={isPending}
          variant="outline"
          className="gap-1.5"
        >
          <Sparkles className="size-4" aria-hidden />
          {isPending
            ? "Generating…"
            : `Generate charges${termName ? ` for ${termName}` : ""}`}
        </Button>
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
