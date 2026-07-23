"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  applyExamTemplateAction,
  bulkArchiveClosedPeriodsAction,
  bulkAssignRoomAction,
  bulkShiftExamDatesAction,
  duplicateExamPeriodAction,
  saveExamTemplateAction,
  setExamPeriodStatusAction,
  upsertExamAction,
  upsertExamExclusionAction,
  upsertExamPeriodAction,
  upsertExamRoomAction,
  upsertExamScheduleAction,
} from "@/features/examinations/actions";
import {
  EXAM_PERIOD_STATUSES,
  EXAM_PERIOD_STATUS_LABELS,
  type ExamConflictWarning,
} from "@/features/examinations/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };
type StaffOption = { id: string; full_name: string; is_active: boolean };

function FieldError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

function FieldOk({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-emerald-700">{message}</p>;
}

export function ExamPeriodForm({
  years,
  terms,
  defaults,
}: {
  years: Option[];
  terms: { id: string; name: string; academic_year_id: string }[];
  defaults?: {
    id?: string;
    academic_year_id?: string;
    term_id?: string | null;
    name?: string;
    description?: string | null;
    opens_on?: string | null;
    closes_on?: string | null;
    status?: (typeof EXAM_PERIOD_STATUSES)[number];
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [yearId, setYearId] = useState(
    defaults?.academic_year_id ?? years[0]?.id ?? "",
  );
  const filteredTerms = terms.filter((t) => t.academic_year_id === yearId);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setMessage(null);
        start(async () => {
          const result = await upsertExamPeriodAction({
            id: defaults?.id || null,
            academic_year_id: String(fd.get("academic_year_id") || ""),
            term_id: String(fd.get("term_id") || "") || null,
            name: String(fd.get("name") || ""),
            description: String(fd.get("description") || "") || null,
            opens_on: String(fd.get("opens_on") || "") || null,
            closes_on: String(fd.get("closes_on") || "") || null,
            status: String(fd.get("status") || "DRAFT"),
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          setMessage("Exam period saved.");
          if (result.id) {
            router.push(`/dashboard/examinations/periods/${result.id}`);
            router.refresh();
          }
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={defaults?.name ?? ""}
          placeholder="e.g. Mid-Term Tests"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="academic_year_id">Academic year</Label>
          <select
            id="academic_year_id"
            name="academic_year_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            required
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="term_id">Term (optional)</Label>
          <select
            id="term_id"
            name="term_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            defaultValue={defaults?.term_id ?? ""}
          >
            <option value="">No specific term</option>
            {filteredTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="opens_on">Opening date</Label>
          <Input
            id="opens_on"
            name="opens_on"
            type="date"
            defaultValue={defaults?.opens_on ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="closes_on">Closing date</Label>
          <Input
            id="closes_on"
            name="closes_on"
            type="date"
            defaultValue={defaults?.closes_on ?? ""}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          defaultValue={defaults?.description ?? ""}
          placeholder="Optional notes for staff"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
          defaultValue={defaults?.status ?? "DRAFT"}
        >
          {EXAM_PERIOD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EXAM_PERIOD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <FieldError error={error} />
      <FieldOk message={message} />
      <Button type="submit" disabled={pending} className="h-11 w-full sm:w-auto">
        {pending ? "Saving…" : defaults?.id ? "Save changes" : "Create exam period"}
      </Button>
    </form>
  );
}

export function DuplicatePeriodForm({
  sourcePeriodId,
  sourceName,
}: {
  sourcePeriodId: string;
  sourceName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded-md border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await duplicateExamPeriodAction({
            source_period_id: sourcePeriodId,
            new_name: String(fd.get("new_name") || ""),
            copy_exams: fd.get("copy_exams") === "on",
            copy_schedules: fd.get("copy_schedules") === "on",
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          if (result.id) {
            router.push(`/dashboard/examinations/periods/${result.id}`);
            router.refresh();
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Copy <span className="font-medium text-foreground">{sourceName}</span> to
        a new exam period.
      </p>
      <div className="space-y-1">
        <Label htmlFor="new_name">New name</Label>
        <Input
          id="new_name"
          name="new_name"
          required
          defaultValue={`Copy of ${sourceName}`}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="copy_exams" defaultChecked className="size-4" />
        Copy exams (subjects and marks totals)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="copy_schedules" className="size-4" />
        Also copy timetable dates (optional)
      </label>
      <FieldError error={error} />
      <Button type="submit" disabled={pending} variant="outline" className="h-11">
        {pending ? "Copying…" : "Copy exam period"}
      </Button>
    </form>
  );
}

export function CreateExamForm({
  periodId,
  subjects,
  grades,
  classes,
  assessmentTypes,
}: {
  periodId: string;
  subjects: Option[];
  grades: Option[];
  classes: { id: string; name: string; grade_level_id: string }[];
  assessmentTypes: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? "");
  const [scope, setScope] = useState<"GRADE" | "CLASS">("GRADE");
  const filteredClasses = classes.filter((c) => c.grade_level_id === gradeId);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await upsertExamAction({
            exam_period_id: periodId,
            subject_id: String(fd.get("subject_id") || ""),
            grade_level_id: String(fd.get("grade_level_id") || ""),
            class_id: scope === "CLASS" ? String(fd.get("class_id") || "") : null,
            assessment_type_id: String(fd.get("assessment_type_id") || ""),
            max_marks: Number(fd.get("max_marks") || 0),
            instructions: String(fd.get("instructions") || "") || null,
            notes: String(fd.get("notes") || "") || null,
            cohort_scope: scope,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          (e.target as HTMLFormElement).reset();
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="grade_level_id">Grade</Label>
          <select
            id="grade_level_id"
            name="grade_level_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            required
            value={gradeId}
            onChange={(e) => setGradeId(e.target.value)}
          >
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="subject_id">Subject</Label>
          <select
            id="subject_id"
            name="subject_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            required
            defaultValue={subjects[0]?.id}
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="assessment_type_id">Assessment type</Label>
          <select
            id="assessment_type_id"
            name="assessment_type_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            required
            defaultValue={assessmentTypes[0]?.id}
          >
            {assessmentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="max_marks">Maximum marks</Label>
          <Input
            id="max_marks"
            name="max_marks"
            type="number"
            min={1}
            step="0.5"
            required
            defaultValue={50}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Students taking this exam</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex h-11 items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="radio"
              name="cohort_ui"
              checked={scope === "GRADE"}
              onChange={() => setScope("GRADE")}
            />
            Everyone in grade
          </label>
          <label className="flex h-11 items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="radio"
              name="cohort_ui"
              checked={scope === "CLASS"}
              onChange={() => setScope("CLASS")}
            />
            Everyone in class
          </label>
        </div>
        {scope === "CLASS" ? (
          <select
            name="class_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Choose class</option>
            {filteredClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Optional instructions
        </summary>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="instructions">Exam instructions</Label>
            <Input
              id="instructions"
              name="instructions"
              placeholder="e.g. Bring calculator · Blue pen only"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Internal notes</Label>
            <Input id="notes" name="notes" placeholder="Staff-only notes" />
          </div>
        </div>
      </details>
      <FieldError error={error} />
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Adding…" : "Add exam"}
      </Button>
    </form>
  );
}

export function ScheduleExamForm({
  examId,
  rooms,
  staff,
  defaults,
}: {
  examId: string;
  rooms: Option[];
  staff: StaffOption[];
  defaults?: {
    exam_date?: string;
    start_time?: string;
    end_time?: string;
    room_id?: string | null;
    primary_invigilator_id?: string | null;
    assistant_invigilator_id?: string | null;
    notes?: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ExamConflictWarning[]>([]);
  const [pendingPayload, setPendingPayload] = useState<Record<
    string,
    unknown
  > | null>(null);

  function submit(allowWarnings: boolean, values: Record<string, unknown>) {
    setError(null);
    start(async () => {
      const result = await upsertExamScheduleAction({
        ...values,
        allow_warnings: allowWarnings,
      });
      if (result.error) {
        setError(result.error);
        setWarnings([]);
        setPendingPayload(null);
        return;
      }
      if (result.requiresConfirmation && result.warnings?.length) {
        setWarnings(result.warnings);
        setPendingPayload(values);
        return;
      }
      setWarnings([]);
      setPendingPayload(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          submit(false, {
            exam_id: examId,
            exam_date: String(fd.get("exam_date") || ""),
            start_time: String(fd.get("start_time") || ""),
            end_time: String(fd.get("end_time") || ""),
            room_id: String(fd.get("room_id") || "") || null,
            primary_invigilator_id:
              String(fd.get("primary_invigilator_id") || "") || null,
            assistant_invigilator_id:
              String(fd.get("assistant_invigilator_id") || "") || null,
            notes: String(fd.get("notes") || "") || null,
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`date-${examId}`}>Date</Label>
            <Input
              id={`date-${examId}`}
              name="exam_date"
              type="date"
              required
              defaultValue={defaults?.exam_date ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`start-${examId}`}>Start</Label>
            <Input
              id={`start-${examId}`}
              name="start_time"
              type="time"
              required
              defaultValue={defaults?.start_time ?? "09:00"}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`end-${examId}`}>End</Label>
            <Input
              id={`end-${examId}`}
              name="end_time"
              type="time"
              required
              defaultValue={defaults?.end_time ?? "11:00"}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`room-${examId}`}>Room</Label>
            <select
              id={`room-${examId}`}
              name="room_id"
              className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue={defaults?.room_id ?? ""}
            >
              <option value="">Not assigned yet</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`primary-${examId}`}>Primary invigilator</Label>
            <select
              id={`primary-${examId}`}
              name="primary_invigilator_id"
              className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue={defaults?.primary_invigilator_id ?? ""}
            >
              <option value="">Not assigned yet</option>
              {staff
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`assistant-${examId}`}>
            Assistant invigilator (optional)
          </Label>
          <select
            id={`assistant-${examId}`}
            name="assistant_invigilator_id"
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
            defaultValue={defaults?.assistant_invigilator_id ?? ""}
          >
            <option value="">None</option>
            {staff
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`notes-${examId}`}>Notes</Label>
          <Input
            id={`notes-${examId}`}
            name="notes"
            defaultValue={defaults?.notes ?? ""}
          />
        </div>
        <FieldError error={error} />
        <Button type="submit" disabled={pending} className="h-11">
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </form>
      {warnings.length > 0 ? (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-950">Please review these warnings</p>
          <ul className="space-y-2">
            {warnings.map((w) => (
              <li key={w.code + w.message}>
                <p className="text-amber-950">{w.message}</p>
                <p className="text-amber-800">How to fix: {w.fix}</p>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={pending || !pendingPayload}
            onClick={() => pendingPayload && submit(true, pendingPayload)}
          >
            Save anyway
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ExamRoomForm({
  defaults,
}: {
  defaults?: {
    id?: string;
    name?: string;
    capacity?: number | null;
    notes?: string | null;
    is_active?: boolean;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await upsertExamRoomAction({
            id: defaults?.id || null,
            name: String(fd.get("name") || ""),
            capacity: fd.get("capacity") ? Number(fd.get("capacity")) : null,
            notes: String(fd.get("notes") || "") || null,
            is_active: fd.get("is_active") === "on",
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          (e.target as HTMLFormElement).reset();
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="room-name">Room name</Label>
          <Input
            id="room-name"
            name="name"
            required
            defaultValue={defaults?.name ?? ""}
            placeholder="e.g. Room 3"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="capacity">Capacity (optional)</Label>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            defaultValue={defaults?.capacity ?? ""}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="room-notes">Notes</Label>
        <Input
          id="room-notes"
          name="notes"
          defaultValue={defaults?.notes ?? ""}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={defaults?.is_active ?? true}
          className="size-4"
        />
        Active
      </label>
      <FieldError error={error} />
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Saving…" : defaults?.id ? "Save room" : "Add room"}
      </Button>
    </form>
  );
}

export function TemplateActions({
  periodId,
  templates,
}: {
  periodId: string;
  templates: { id: string; name: string; item_count: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          setMessage(null);
          start(async () => {
            const result = await saveExamTemplateAction({
              period_id: periodId,
              template_name: String(fd.get("template_name") || ""),
              description: String(fd.get("description") || "") || null,
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage("Template saved.");
            router.refresh();
          });
        }}
      >
        <p className="text-sm font-medium">Save as template</p>
        <Input
          name="template_name"
          required
          placeholder="e.g. Mid-Term Template"
        />
        <Input name="description" placeholder="Optional description" />
        <Button type="submit" disabled={pending} variant="outline" className="h-11">
          Save template from this period
        </Button>
      </form>

      <form
        className="space-y-3 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          setMessage(null);
          start(async () => {
            const result = await applyExamTemplateAction({
              template_id: String(fd.get("template_id") || ""),
              exam_period_id: periodId,
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage(`Added ${result.count ?? 0} exams from template.`);
            router.refresh();
          });
        }}
      >
        <p className="text-sm font-medium">Apply template</p>
        <select
          name="template_id"
          required
          className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Choose template
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.item_count} subjects)
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending || templates.length === 0} className="h-11">
          Copy from template
        </Button>
      </form>
      <FieldError error={error} />
      <FieldOk message={message} />
    </div>
  );
}

export function BulkScheduleTools({
  periodId,
  rooms,
}: {
  periodId: string;
  rooms: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const result = await bulkShiftExamDatesAction({
              exam_period_id: periodId,
              day_offset: Number(fd.get("day_offset") || 0),
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage(`Moved ${result.count ?? 0} scheduled exams.`);
            router.refresh();
          });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="day_offset">Move all dates by (days)</Label>
          <Input id="day_offset" name="day_offset" type="number" required defaultValue={7} />
        </div>
        <Button type="submit" disabled={pending} variant="outline" className="h-11">
          Bulk move dates
        </Button>
      </form>
      <form
        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const result = await bulkAssignRoomAction({
              exam_period_id: periodId,
              room_id: String(fd.get("room_id") || ""),
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage(`Assigned room to ${result.count ?? 0} exams.`);
            router.refresh();
          });
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="bulk-room">Bulk assign room</Label>
          <select
            id="bulk-room"
            name="room_id"
            required
            className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending || rooms.length === 0} className="h-11">
          Assign to all scheduled
        </Button>
      </form>
      <FieldError error={error} />
      <FieldOk message={message} />
    </div>
  );
}

export function PeriodStatusButtons({
  periodId,
  status,
}: {
  periodId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<
    (typeof EXAM_PERIOD_STATUSES)[number] | null
  >(null);

  function apply(next: (typeof EXAM_PERIOD_STATUSES)[number], force: boolean) {
    setError(null);
    start(async () => {
      const result = await setExamPeriodStatusAction(periodId, next, force);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.requiresConfirmation) {
        setConfirmMsg(result.message ?? "Confirm archive?");
        setPendingStatus(next);
        return;
      }
      setConfirmMsg(null);
      setPendingStatus(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {EXAM_PERIOD_STATUSES.filter((s) => s !== status).map((s) => (
          <Button
            key={s}
            type="button"
            variant="outline"
            className="h-11"
            disabled={pending}
            onClick={() => apply(s, false)}
          >
            Mark {EXAM_PERIOD_STATUS_LABELS[s].toLowerCase()}
          </Button>
        ))}
      </div>
      {confirmMsg && pendingStatus ? (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>{confirmMsg}</p>
          <Button
            type="button"
            className="h-11"
            disabled={pending}
            onClick={() => apply(pendingStatus, true)}
          >
            Archive anyway
          </Button>
        </div>
      ) : null}
      <FieldError error={error} />
    </div>
  );
}

export function ArchiveClosedButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await bulkArchiveClosedPeriodsAction();
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage(`Archived ${result.count ?? 0} closed periods.`);
            router.refresh();
          });
        }}
      >
        Archive all closed periods
      </Button>
      <FieldError error={error} />
      <FieldOk message={message} />
    </div>
  );
}

export function ExamExclusionForm({
  exams,
  students,
}: {
  exams: { id: string; label: string }[];
  students: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Advanced — exclude a student from an exam
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          setMessage(null);
          start(async () => {
            const result = await upsertExamExclusionAction({
              exam_id: String(fd.get("exam_id") || ""),
              student_id: String(fd.get("student_id") || ""),
              reason: String(fd.get("reason") || "OTHER"),
              notes: String(fd.get("notes") || "") || null,
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage("Student excluded from this exam.");
            router.refresh();
          });
        }}
      >
        <p className="text-sm text-muted-foreground">
          By default everyone in the grade or class sits the exam. Use this only
          for medical exemption, transfer, or similar cases.
        </p>
        <select
          name="exam_id"
          required
          className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Choose exam
          </option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.label}
            </option>
          ))}
        </select>
        <select
          name="student_id"
          required
          className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Choose student
          </option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.label}
            </option>
          ))}
        </select>
        <select
          name="reason"
          className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
          defaultValue="MEDICAL"
        >
          <option value="MEDICAL">Medically exempt</option>
          <option value="TRANSFERRED">Transferred</option>
          <option value="ABSENT">Absent</option>
          <option value="OTHER">Other</option>
        </select>
        <Input name="notes" placeholder="Optional note" />
        <FieldError error={error} />
        <FieldOk message={message} />
        <Button type="submit" disabled={pending} variant="outline" className="h-11">
          Exclude student
        </Button>
      </form>
    </details>
  );
}

export function PrintLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "h-11")}>
      {label}
    </Link>
  );
}
