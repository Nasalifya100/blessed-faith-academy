"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createClassAction,
  upsertSubjectAction,
  setSubjectActiveAction,
  bulkSetGradeOfferingsAction,
  assignTeacherAction,
  endTeachingAssignmentAction,
  saveGradingSchemeAction,
  seedAssessmentTypesResultAction,
  saveWeightSchemeAction,
  upsertWorkflowPeriodAction,
} from "@/features/academics/actions";
import {
  RECOMMENDED_GRADING_BANDS,
  SUBJECT_CATEGORIES,
  SUBJECT_CATEGORY_LABELS,
  WORKFLOW_TYPE_LABELS,
  weightTotal,
} from "@/features/academics/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Option = { id: string; name: string };

export function CreateClassForm({
  years,
  grades,
}: {
  years: Option[];
  grades: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setMessage(null);
        start(async () => {
          const result = await createClassAction({
            academic_year_id: String(fd.get("academic_year_id") || ""),
            grade_level_id: String(fd.get("grade_level_id") || ""),
            name: String(fd.get("name") || ""),
            stream_code: String(fd.get("stream_code") || "") || null,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          setMessage("Class saved.");
          (e.target as HTMLFormElement).reset();
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="academic_year_id">Academic year</Label>
          <select
            id="academic_year_id"
            name="academic_year_id"
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            required
            defaultValue={years[0]?.id}
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="grade_level_id">Grade</Label>
          <select
            id="grade_level_id"
            name="grade_level_id"
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Select grade</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="name">Class name</Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g. Grade 7 or Grade 7A"
            required
          />
          <p className="text-xs text-muted-foreground">
            For a single class you can keep a simple name like “Grade 5”.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="stream_code">Stream (optional)</Label>
          <Input id="stream_code" name="stream_code" placeholder="A" />
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add class"}
      </Button>
    </form>
  );
}

export function SubjectForm({
  initial,
}: {
  initial?: {
    id: string;
    name: string;
    short_name: string | null;
    code: string | null;
    subject_category: string;
    description: string | null;
    is_active: boolean;
  } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await upsertSubjectAction({
            id: initial?.id ?? null,
            name: String(fd.get("name") || ""),
            short_name: String(fd.get("short_name") || "") || null,
            code: String(fd.get("code") || "") || null,
            subject_category: String(fd.get("subject_category") || "CORE"),
            description: String(fd.get("description") || "") || null,
            is_active: fd.get("is_active") === "on" || !initial,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
          if (!initial) (e.target as HTMLFormElement).reset();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="name">Subject name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Mathematics"
        />
      </div>
      <button
        type="button"
        className="text-sm underline underline-offset-2"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide optional fields" : "Optional fields"}
      </button>
      {showAdvanced ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="short_name">Short name</Label>
            <Input
              id="short_name"
              name="short_name"
              defaultValue={initial?.short_name ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" defaultValue={initial?.code ?? ""} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="subject_category">Category</Label>
            <select
              id="subject_category"
              name="subject_category"
              className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue={initial?.subject_category ?? "CORE"}
            >
              {SUBJECT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SUBJECT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              defaultValue={initial?.description ?? ""}
            />
          </div>
        </div>
      ) : (
        <input type="hidden" name="subject_category" value="CORE" />
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : initial ? "Update subject" : "Add subject"}
      </Button>
    </form>
  );
}

export function SubjectActiveToggle({
  subjectId,
  isActive,
  name,
}: {
  subjectId: string;
  isActive: boolean;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {isActive ? "Deactivate" : "Activate"}
      </Button>
      <ConfirmDialog
        open={open}
        title={`${isActive ? "Deactivate" : "Activate"} ${name}?`}
        description={
          isActive
            ? "Deactivated subjects cannot be newly offered to grades."
            : "This subject will be available for grade assignment again."
        }
        confirmLabel={isActive ? "Deactivate" : "Activate"}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setError(null);
          start(async () => {
            const result = await setSubjectActiveAction({
              subjectId,
              isActive: !isActive,
            });
            setOpen(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </>
  );
}

export function GradeSubjectsForm({
  years,
  grades,
  subjects,
  initialSelected,
}: {
  years: Option[];
  grades: Option[];
  subjects: Array<{ id: string; name: string }>;
  initialSelected: Array<{ subject_id: string; is_compulsory: boolean }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [yearId, setYearId] = useState(years[0]?.id ?? "");
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? "");
  const initialMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of initialSelected) {
      map.set(item.subject_id, item.is_compulsory);
    }
    return map;
  }, [initialSelected]);
  const [selected, setSelected] = useState<Map<string, boolean>>(initialMap);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setMessage(null);
        const items = [...selected.entries()].map(([subject_id, is_compulsory]) => ({
          subject_id,
          is_compulsory,
        }));
        start(async () => {
          const result = await bulkSetGradeOfferingsAction({
            academic_year_id: yearId,
            grade_level_id: gradeId,
            items,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          setMessage("Subjects saved for this grade.");
          router.refresh();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Choose the subjects taught in this grade. You can assign teachers
        afterward.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Academic year</Label>
          <select
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
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
          <Label>Grade</Label>
          <select
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
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
      </div>
      <ul className="divide-y rounded-md border">
        {subjects.map((subject) => {
          const checked = selected.has(subject.id);
          const compulsory = selected.get(subject.id) ?? true;
          return (
            <li
              key={subject.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Map(selected);
                    if (e.target.checked) next.set(subject.id, true);
                    else next.delete(subject.id);
                    setSelected(next);
                  }}
                />
                {subject.name}
              </label>
              {checked ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={compulsory}
                    onChange={(e) => {
                      const next = new Map(selected);
                      next.set(subject.id, e.target.checked);
                      setSelected(next);
                    }}
                  />
                  Compulsory
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save subjects for grade"}
      </Button>
    </form>
  );
}

export function AssignTeacherForm({
  offerings,
  teachers,
}: {
  offerings: Array<{ id: string; label: string }>;
  teachers: Option[];
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
          const result = await assignTeacherAction({
            subject_offering_id: String(fd.get("subject_offering_id") || ""),
            staff_id: String(fd.get("staff_id") || ""),
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label>Subject (by grade)</Label>
        <select
          name="subject_offering_id"
          className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="">Select subject</option>
          {offerings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Teacher</Label>
        <select
          name="staff_id"
          className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="">Select teacher</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Assign teacher"}
      </Button>
    </form>
  );
}

export function EndAssignmentButton({
  assignmentId,
  label,
}: {
  assignmentId: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        End
      </Button>
      <ConfirmDialog
        open={open}
        title={`End assignment for ${label}?`}
        description="The assignment is ended rather than deleted, so history stays intact."
        confirmLabel="End assignment"
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          start(async () => {
            await endTeachingAssignmentAction(assignmentId);
            setOpen(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}

export function GradingScaleForm({
  schemeId,
  initialName,
  initialBands,
}: {
  schemeId?: string | null;
  initialName?: string;
  initialBands?: Array<{
    minimum_score: number;
    maximum_score: number;
    grade_code: string;
    grade_label: string;
    is_pass: boolean;
  }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bands, setBands] = useState(
    () =>
      initialBands?.map((b) => ({ ...b })) ??
      RECOMMENDED_GRADING_BANDS.map((b) => ({ ...b })),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  function save(confirm: boolean) {
    setError(null);
    start(async () => {
      const result = await saveGradingSchemeAction({
        id: schemeId ?? null,
        name: "School grading scale",
        bands,
        make_default: true,
        confirm,
      });
      if (result.error) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        Review and confirm this grading scale before marks are entered. These
        values are a recommended starting point — edit them to match school
        policy.
      </p>
      <div className="space-y-3">
        {bands.map((band, index) => (
          <div
            key={`${band.grade_code}-${index}`}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-5"
          >
            <div className="space-y-1">
              <Label>Min</Label>
              <Input
                type="number"
                step="0.01"
                value={band.minimum_score}
                onChange={(e) => {
                  const next = [...bands];
                  next[index] = {
                    ...band,
                    minimum_score: Number(e.target.value),
                  };
                  setBands(next);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Max</Label>
              <Input
                type="number"
                step="0.01"
                value={band.maximum_score}
                onChange={(e) => {
                  const next = [...bands];
                  next[index] = {
                    ...band,
                    maximum_score: Number(e.target.value),
                  };
                  setBands(next);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Code</Label>
              <Input
                value={band.grade_code}
                onChange={(e) => {
                  const next = [...bands];
                  next[index] = { ...band, grade_code: e.target.value };
                  setBands(next);
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Label</Label>
              <Input
                value={band.grade_label}
                onChange={(e) => {
                  const next = [...bands];
                  next[index] = { ...band, grade_label: e.target.value };
                  setBands(next);
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
        <Button type="button" disabled={pending} onClick={() => setConfirmOpen(true)}>
          Confirm grading scale
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm this grading scale?"
        description="Confirming marks this scale as ready for later marks entry. You can still edit it until results are published in a later phase."
        confirmLabel="Confirm scale"
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => save(true)}
      />
      {initialName ? (
        <p className="text-xs text-muted-foreground">Current scale: {initialName}</p>
      ) : null}
    </div>
  );
}

export function WeightSchemeForm({
  assessmentTypes,
  schemeId,
  initialItems,
}: {
  assessmentTypes: Array<{ id: string; name: string }>;
  schemeId?: string | null;
  initialItems?: Array<{ assessment_type_id: string; weight_percentage: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const recommended = useMemo(() => {
    const byName = new Map(assessmentTypes.map((t) => [t.name.toLowerCase(), t.id]));
    const picks: Array<{ assessment_type_id: string; weight_percentage: number; label: string }> = [];
    const want = [
      ["assignment", 10],
      ["test", 20],
      ["mid-term examination", 30],
      ["end-of-term examination", 40],
    ] as const;
    for (const [name, pct] of want) {
      const id = byName.get(name);
      if (id) picks.push({ assessment_type_id: id, weight_percentage: pct, label: name });
    }
    return picks;
  }, [assessmentTypes]);

  const [items, setItems] = useState(() => {
    if (initialItems?.length) {
      return initialItems.map((i) => ({
        ...i,
        label:
          assessmentTypes.find((t) => t.id === i.assessment_type_id)?.name ??
          "Type",
      }));
    }
    return recommended;
  });
  const total = weightTotal(items);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function save(confirm: boolean) {
    setError(null);
    start(async () => {
      const result = await saveWeightSchemeAction({
        id: schemeId ?? null,
        name: "Default term weights",
        items: items.map((i, idx) => ({
          assessment_type_id: i.assessment_type_id,
          weight_percentage: i.weight_percentage,
          display_order: idx + 1,
        })),
        make_default: true,
        confirm,
      });
      if (result.error) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await seedAssessmentTypesResultAction();
            router.refresh();
          }}
        >
          Ensure common assessment types
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setItems(recommended)}
        >
          Use recommended template
        </Button>
      </div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            key={`${item.assessment_type_id}-${index}`}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span className="text-sm capitalize">{item.label}</span>
            <Input
              className="w-24"
              type="number"
              min={0}
              max={100}
              value={item.weight_percentage}
              onChange={(e) => {
                const next = [...items];
                next[index] = {
                  ...item,
                  weight_percentage: Number(e.target.value),
                };
                setItems(next);
              }}
            />
          </li>
        ))}
      </ul>
      <p
        className={`text-sm font-medium ${
          Math.abs(total - 100) < 0.001 ? "text-foreground" : "text-destructive"
        }`}
      >
        Total: {total}%
        {Math.abs(total - 100) >= 0.001
          ? " — must equal 100% before saving."
          : null}
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button type="button" disabled={pending} onClick={() => setConfirmOpen(true)}>
          Confirm weights
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm assessment weights?"
        description="This marks the weight template as ready for later mark calculations."
        confirmLabel="Confirm weights"
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => save(true)}
      />
    </div>
  );
}

export function WorkflowDatesForm({
  years,
  terms,
}: {
  years: Option[];
  terms: Array<Option & { academic_year_id?: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [yearId, setYearId] = useState(years[0]?.id ?? "");
  const yearTerms = terms.filter(
    (t) => !t.academic_year_id || t.academic_year_id === yearId,
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await upsertWorkflowPeriodAction({
            academic_year_id: yearId,
            term_id: String(fd.get("term_id") || "") || null,
            workflow_type: String(fd.get("workflow_type") || "MARKS_ENTRY"),
            starts_at: String(fd.get("starts_at") || ""),
            ends_at: String(fd.get("ends_at") || "") || null,
            notes: String(fd.get("notes") || "") || null,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Optional. You can skip academic dates during initial setup.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Academic year</Label>
          <select
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
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
          <Label>Term (optional)</Label>
          <select
            name="term_id"
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            defaultValue=""
          >
            <option value="">Whole year</option>
            {yearTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Date type</Label>
          <select
            name="workflow_type"
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            defaultValue="MARKS_ENTRY"
          >
            {Object.entries(WORKFLOW_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Opens</Label>
          <Input name="starts_at" type="date" required />
        </div>
        <div className="space-y-1">
          <Label>Closes (optional)</Label>
          <Input name="ends_at" type="date" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Notes (optional)</Label>
          <Input name="notes" />
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save academic dates"}
      </Button>
    </form>
  );
}
