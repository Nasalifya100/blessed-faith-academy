"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createDisciplineIncidentAction } from "@/features/discipline/actions";
import type { SchoolRuleRow } from "@/features/discipline/queries";
import {
  DISCIPLINE_SEVERITIES,
  DISCIPLINE_SEVERITY_LABELS,
} from "@/features/discipline/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface RecordDisciplineIncidentFormProps {
  studentId: string;
  rules: SchoolRuleRow[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function RecordDisciplineIncidentForm({
  studentId,
  rules,
}: RecordDisciplineIncidentFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [severity, setSeverity] = useState<(typeof DISCIPLINE_SEVERITIES)[number]>("low");
  const [incidentDate, setIncidentDate] = useState(today());
  const [relatedRuleId, setRelatedRuleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDisciplineIncidentAction({
        studentId,
        title,
        description,
        actionTaken,
        severity,
        incidentDate,
        relatedRuleId: relatedRuleId || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setDescription("");
      setActionTaken("");
      setSeverity("low");
      setIncidentDate(today());
      setRelatedRuleId("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Record incident
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border p-4"
      noValidate
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Record discipline incident</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="incident-title">Title</Label>
          <Input
            id="incident-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            placeholder="e.g. Disruptive behaviour in class"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="incident-date">Date</Label>
          <Input
            id="incident-date"
            type="date"
            value={incidentDate}
            onChange={(event) => setIncidentDate(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="severity">Severity</Label>
          <SelectNative
            id="severity"
            value={severity}
            onChange={(event) =>
              setSeverity(event.target.value as typeof severity)
            }
          >
            {DISCIPLINE_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {DISCIPLINE_SEVERITY_LABELS[value]}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="related-rule">Related rule (optional)</Label>
          <SelectNative
            id="related-rule"
            value={relatedRuleId}
            onChange={(event) => setRelatedRuleId(event.target.value)}
          >
            <option value="">— None —</option>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.title}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="description">What happened</Label>
          <textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="action-taken">Action taken (optional)</Label>
          <Input
            id="action-taken"
            value={actionTaken}
            onChange={(event) => setActionTaken(event.target.value)}
            placeholder="e.g. Verbal warning; parents called"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending || !title.trim()}>
        {isPending ? "Saving..." : "Save incident"}
      </Button>
    </form>
  );
}
