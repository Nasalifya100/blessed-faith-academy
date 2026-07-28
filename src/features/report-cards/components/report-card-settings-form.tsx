"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateReportCardSettingsAction } from "@/features/report-cards/actions";
import type { ReportCardSettings } from "@/features/report-cards/types";
import { Button } from "@/components/ui/button";

export function ReportCardSettingsForm({
  settings,
}: {
  settings: ReportCardSettings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(settings);

  function setBool(key: keyof ReportCardSettings, value: boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await updateReportCardSettingsAction({
            title: form.title,
            show_school_logo: form.show_school_logo,
            show_admission_number: form.show_admission_number,
            show_class_position: form.show_class_position,
            show_subject_position: form.show_subject_position,
            show_grade_points: form.show_grade_points,
            show_promotion_recommendation: form.show_promotion_recommendation,
            show_attendance: form.show_attendance,
            show_teacher_remark: form.show_teacher_remark,
            show_headteacher_remark: form.show_headteacher_remark,
            show_grading_key: form.show_grading_key,
            show_generated_timestamp: form.show_generated_timestamp,
            require_teacher_remark_for_review:
              form.require_teacher_remark_for_review,
            require_headteacher_remark_for_approve:
              form.require_headteacher_remark_for_approve,
            footer_text: form.footer_text ?? "",
            ranking_disabled_message: form.ranking_disabled_message,
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
      <label className="grid gap-1 text-sm">
        <span>Report card title</span>
        <input
          className="h-10 rounded-md border bg-background px-3"
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          maxLength={120}
          required
        />
      </label>

      <fieldset className="space-y-2 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">Display options</legend>
        {(
          [
            ["show_school_logo", "Show school logo"],
            ["show_admission_number", "Show admission number"],
            ["show_class_position", "Show class position"],
            ["show_subject_position", "Show subject position"],
            ["show_grade_points", "Show grade points"],
            ["show_promotion_recommendation", "Show promotion recommendation"],
            ["show_attendance", "Show attendance"],
            ["show_teacher_remark", "Show teacher remark"],
            ["show_headteacher_remark", "Show head teacher remark"],
            ["show_grading_key", "Show grading key"],
            ["show_generated_timestamp", "Show generated timestamp"],
            [
              "require_teacher_remark_for_review",
              "Require teacher remark before review",
            ],
            [
              "require_headteacher_remark_for_approve",
              "Require head teacher remark before approval",
            ],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form[key])}
              onChange={(e) => setBool(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="grid gap-1 text-sm">
        <span>Ranking disabled message</span>
        <input
          className="h-10 rounded-md border bg-background px-3"
          value={form.ranking_disabled_message}
          onChange={(e) =>
            setForm((p) => ({
              ...p,
              ranking_disabled_message: e.target.value,
            }))
          }
          maxLength={300}
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Footer text</span>
        <textarea
          className="min-h-20 rounded-md border bg-background px-3 py-2"
          value={form.footer_text ?? ""}
          onChange={(e) =>
            setForm((p) => ({
              ...p,
              footer_text: e.target.value || null,
            }))
          }
          maxLength={2000}
        />
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">
        Changing settings does not alter already approved or published report
        cards. Those keep their immutable render snapshot.
      </p>
    </form>
  );
}
