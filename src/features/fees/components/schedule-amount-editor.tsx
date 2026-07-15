"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateScheduleAmountAction } from "@/features/fees/actions";
import { formatKwacha } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ScheduleAmountEditorProps {
  scheduleId: string;
  initialAmount: number;
  canEdit: boolean;
}

export function ScheduleAmountEditor({
  scheduleId,
  initialAmount,
  canEdit,
}: ScheduleAmountEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialAmount));
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <span className="font-medium">{formatKwacha(initialAmount)}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="font-medium hover:underline"
        onClick={() => {
          setValue(String(initialAmount));
          setError(null);
          setEditing(true);
        }}
      >
        {formatKwacha(initialAmount)}
      </button>
    );
  }

  function save() {
    setError(null);
    const amount = Number(value);
    if (Number.isNaN(amount) || amount < 0) {
      setError("Enter a valid amount");
      return;
    }

    startTransition(async () => {
      const result = await updateScheduleAmountAction({
        scheduleId,
        amount,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">K</span>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 w-28"
          disabled={isPending}
        />
        <Button size="sm" onClick={save} disabled={isPending}>
          {isPending ? "..." : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
