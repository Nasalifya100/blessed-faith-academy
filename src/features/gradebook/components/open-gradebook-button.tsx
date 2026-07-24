"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { openOrGetExamGradebookAction } from "@/features/gradebook/actions";
import { Button } from "@/components/ui/button";

export function OpenGradebookButton({
  examId,
  classId,
  gradebookId,
  label,
  variant = "default",
}: {
  examId: string;
  classId: string;
  gradebookId?: string | null;
  label: string;
  variant?: "default" | "outline" | "secondary";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (pending) return;
    setError(null);
    if (gradebookId) {
      router.push(`/dashboard/gradebook/${gradebookId}`);
      return;
    }
    startTransition(async () => {
      const result = await openOrGetExamGradebookAction({
        exam_id: examId,
        class_id: classId,
      });
      if (result.error || !("data" in result) || !result.data) {
        setError(result.error ?? "Could not open gradebook.");
        return;
      }
      router.push(`/dashboard/gradebook/${result.data.gradebook.id}`);
    });
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={variant}
        className="min-h-11 w-full sm:w-auto"
        disabled={pending}
        onClick={onClick}
      >
        {pending ? "Opening…" : label}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
