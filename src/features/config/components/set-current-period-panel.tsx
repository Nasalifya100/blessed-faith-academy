"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setCurrentAcademicYearAction,
  setCurrentTermAction,
} from "@/features/config/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

export interface YearOption {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface TermOption {
  id: string;
  name: string;
  academicYearId: string;
  isCurrent: boolean;
}

interface SetCurrentPeriodPanelProps {
  years: YearOption[];
  terms: TermOption[];
}

export function SetCurrentPeriodPanel({
  years,
  terms,
}: SetCurrentPeriodPanelProps) {
  const router = useRouter();
  const [yearId, setYearId] = useState(
    years.find((y) => y.isCurrent)?.id ?? years[0]?.id ?? "",
  );
  const [termId, setTermId] = useState(
    terms.find((t) => t.isCurrent)?.id ?? terms[0]?.id ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const termsForYear = terms.filter((t) => t.academicYearId === yearId);

  function runYear() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await setCurrentAcademicYearAction({ id: yearId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Current academic year updated.");
      router.refresh();
    });
  }

  function runTerm() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await setCurrentTermAction({ id: termId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Current term updated.");
      router.refresh();
    });
  }

  if (years.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No academic years are configured yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="current-year">Academic year</Label>
          <SelectNative
            id="current-year"
            value={yearId}
            onChange={(event) => {
              setYearId(event.target.value);
              const nextTerms = terms.filter(
                (t) => t.academicYearId === event.target.value,
              );
              setTermId(nextTerms.find((t) => t.isCurrent)?.id ?? nextTerms[0]?.id ?? "");
            }}
            disabled={isPending}
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
                {year.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </SelectNative>
        </div>
        <Button type="button" disabled={isPending || !yearId} onClick={runYear}>
          Set current year
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="current-term">Term</Label>
          <SelectNative
            id="current-term"
            value={termId}
            onChange={(event) => setTermId(event.target.value)}
            disabled={isPending || termsForYear.length === 0}
          >
            {termsForYear.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
                {term.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </SelectNative>
        </div>
        <Button
          type="button"
          disabled={isPending || !termId}
          onClick={runTerm}
        >
          Set current term
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
        Only one current year and one current term are allowed per school. Set
        the year first, then the term in that year.
      </p>
    </div>
  );
}
