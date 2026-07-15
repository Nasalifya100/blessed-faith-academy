"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateSchoolRuleAction } from "@/features/discipline/actions";
import type { SchoolRuleRow } from "@/features/discipline/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface SchoolRulesEditorProps {
  rules: SchoolRuleRow[];
  canEdit: boolean;
}

export function SchoolRulesList({ rules, canEdit }: SchoolRulesEditorProps) {
  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No school rules found. Run migration{" "}
        <code className="text-xs">20260715250100_seed_school_rules_if_empty.sql</code>{" "}
        in Supabase, then refresh.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) =>
        canEdit ? (
          <SchoolRuleEditor key={rule.id} rule={rule} />
        ) : (
          <article
            key={rule.id}
            className="space-y-2 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{rule.title}</h3>
              {!rule.isActive ? (
                <Badge variant="outline">Inactive</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {rule.body}
            </p>
          </article>
        ),
      )}
    </div>
  );
}

function SchoolRuleEditor({ rule }: { rule: SchoolRuleRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(rule.title);
  const [body, setBody] = useState(rule.body);
  const [sortOrder, setSortOrder] = useState(rule.sortOrder);
  const [isActive, setIsActive] = useState(rule.isActive);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updateSchoolRuleAction({
        ruleId: rule.id,
        title,
        body,
        sortOrder,
        isActive,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-2">
          <Label htmlFor={`title-${rule.id}`}>Title</Label>
          <Input
            id={`title-${rule.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`order-${rule.id}`}>Order</Label>
          <Input
            id={`order-${rule.id}`}
            type="number"
            min={0}
            value={sortOrder}
            onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
            className="w-24"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`body-${rule.id}`}>Rule text</Label>
        <textarea
          id={`body-${rule.id}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={isPending} onClick={onSave}>
          {isPending ? "Saving..." : "Save rule"}
        </Button>
        {message ? (
          <p className="text-sm text-emerald-600">{message}</p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
