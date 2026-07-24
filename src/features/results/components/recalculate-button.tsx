"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { recalculateClassTermAction } from "@/features/results/actions";
import { Button } from "@/components/ui/button";

export function RecalculateResultsButton(props: {
  academicYearId: string;
  termId: string;
  classId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        disabled={pending || !props.academicYearId || !props.termId || !props.classId}
        onClick={() => {
          setMessage(null);
          setError(null);
          startTransition(async () => {
            const result = await recalculateClassTermAction({
              academic_year_id: props.academicYearId,
              term_id: props.termId,
              class_id: props.classId,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage(result.message);
            router.refresh();
          });
        }}
      >
        {pending ? "Recalculating…" : "Recalculate results"}
      </Button>
      {message ? (
        <p className="text-sm text-emerald-700" role="status">
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
