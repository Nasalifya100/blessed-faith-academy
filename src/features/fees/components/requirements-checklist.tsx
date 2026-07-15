"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setRequirementReceivedAction } from "@/features/fees/actions";
import type { StudentRequirementRow } from "@/features/fees/queries";
import { REQUIREMENT_BAND_LABELS } from "@/features/fees/schemas";
import { Badge } from "@/components/ui/badge";

interface RequirementsChecklistProps {
  studentId: string;
  academicYearName: string | null;
  gradeLevelName: string | null;
  band: string | null;
  items: StudentRequirementRow[];
  receivedCount: number;
  totalCount: number;
  canEdit: boolean;
}

function formatReceivedOn(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RequirementsChecklist({
  studentId,
  academicYearName,
  gradeLevelName,
  band,
  items,
  receivedCount,
  totalCount,
  canEdit,
}: RequirementsChecklistProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onToggle(item: StudentRequirementRow, next: boolean) {
    if (!canEdit) return;
    setError(null);
    setPendingId(item.id);
    startTransition(async () => {
      const result = await setRequirementReceivedAction({
        studentId,
        requirementItemId: item.id,
        isReceived: next,
        notes: item.notes,
      });
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (!band) {
    return (
      <p className="text-sm text-muted-foreground">
        Enrol this student in a class for the current year to see the
        requirements checklist for their grade band.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No requirement items are set up for this grade band yet. Check Fees
        &amp; requirements.
      </p>
    );
  }

  const complete = receivedCount === totalCount && totalCount > 0;
  const progressPct =
    totalCount > 0 ? Math.round((receivedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={complete ? "secondary" : "outline"}>
          {receivedCount} / {totalCount} received
        </Badge>
        {gradeLevelName ? (
          <span className="text-sm text-muted-foreground">{gradeLevelName}</span>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {band in REQUIREMENT_BAND_LABELS
            ? REQUIREMENT_BAND_LABELS[band]
            : band}
          {academicYearName ? ` · ${academicYearName}` : ""}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Requirements progress"
      >
        <div
          className={`h-full transition-all ${
            complete ? "bg-emerald-600" : "bg-foreground/70"
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Items parents bring — not fee charges.
        {canEdit ? " Tick each item when it arrives." : ""}
      </p>

      <ul className="divide-y rounded-lg border">
        {items.map((item) => {
          const busy = isPending && pendingId === item.id;
          return (
            <li
              key={item.id}
              className="flex items-start gap-3 px-3 py-2.5 text-sm"
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-input"
                checked={item.isReceived}
                disabled={!canEdit || busy}
                onChange={(event) => onToggle(item, event.target.checked)}
                aria-label={`Mark ${item.name} as received`}
              />
              <div className="min-w-0 flex-1">
                <p className={item.isReceived ? "text-muted-foreground" : ""}>
                  {item.name}
                  {item.quantity ? (
                    <span className="text-muted-foreground">
                      {" "}
                      × {item.quantity}
                    </span>
                  ) : null}
                </p>
                {item.isReceived && item.receivedOn ? (
                  <p className="text-xs text-muted-foreground">
                    Received {formatReceivedOn(item.receivedOn)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
