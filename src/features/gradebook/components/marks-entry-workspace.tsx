"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  saveExamGradebookDraftAction,
  submitExamGradebookAction,
} from "@/features/gradebook/actions";
import {
  ReopenGradebookControls,
  LockGradebookControls,
} from "@/features/gradebook/components/admin-gradebook-controls";
import { GradebookStatusBadge } from "@/features/gradebook/components/gradebook-status-badge";
import {
  applyEntryStatus,
  applyMarkText,
  buildDraftPayloadRows,
  canProceedToReview,
  computeSummary,
  displayName,
  emptyEditableRow,
  rowFromServerResult,
  rowsEqual,
  SUBMIT_CONFIRMATION_TEXT,
  validateEditableRow,
  type EditableResultRow,
} from "@/features/gradebook/entry-logic";
import { isEditableGradebookStatus } from "@/features/gradebook/mappers";
import {
  buildRecoveryPayload,
  clearLocalRecovery,
  findStaleLocalRecovery,
  readLocalRecovery,
  writeLocalRecovery,
} from "@/features/gradebook/local-recovery";
import {
  RESULT_ENTRY_STATUSES,
  RESULT_ENTRY_STATUS_LABELS,
  type ResultEntryStatus,
} from "@/features/gradebook/schemas";
import type { GradebookWorkspace } from "@/features/gradebook/queries";
import { BackLink, PageHeader, PageShell } from "@/components/layout/page-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { fixedFormFooterClass } from "@/components/ui/admin-chrome";
import { cn } from "@/lib/utils";

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function buildRows(workspace: GradebookWorkspace): EditableResultRow[] {
  const byStudent = new Map(
    workspace.open.results.map((r) => [r.student_id, r]),
  );
  return workspace.open.roster.map((s) =>
    rowFromServerResult(s, byStudent.get(s.student_id)),
  );
}

type SaveState =
  | "saved"
  | "unsaved"
  | "saving"
  | "failed"
  | "restored"
  | "conflict";

export function MarksEntryWorkspace({
  workspace,
  mode = "edit",
}: {
  workspace: GradebookWorkspace;
  mode?: "edit" | "preview";
}) {
  const router = useRouter();
  const { open, labels, capabilities, viewerUserId } = workspace;
  const maxMarks = open.exam.max_marks;
  const editable =
    capabilities.can_edit &&
    isEditableGradebookStatus(open.gradebook.status) &&
    mode === "edit";

  const [rows, setRows] = useState<EditableResultRow[]>(() =>
    buildRows(workspace),
  );
  const [baseline, setBaseline] = useState<EditableResultRow[]>(() =>
    buildRows(workspace),
  );
  const [revision, setRevision] = useState(open.gradebook.revision);
  const [lastSavedAt, setLastSavedAt] = useState(
    open.gradebook.last_saved_at,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearConfirm, setClearConfirm] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveryPrompt, setRecoveryPrompt] = useState<{
    kind: "exact" | "stale";
    rowCount: number;
    savedAt: string;
    revision: number;
  } | null>(null);
  const markRefs = useRef<Array<HTMLInputElement | null>>([]);
  const firstInvalidRef = useRef<string | null>(null);

  const dirty = useMemo(() => !rowsEqual(rows, baseline), [rows, baseline]);
  const summary = useMemo(
    () => computeSummary(rows, maxMarks),
    [rows, maxMarks],
  );
  const revisionConflict = saveState === "conflict";
  const reviewGate = canProceedToReview(rows, maxMarks, {
    dirty,
    revisionConflict,
  });

  const displaySaveState: SaveState = useMemo(() => {
    if (
      saveState === "saving" ||
      saveState === "failed" ||
      saveState === "conflict" ||
      saveState === "restored"
    ) {
      return saveState;
    }
    return dirty ? "unsaved" : "saved";
  }, [dirty, saveState]);

  // localStorage is an external system — check once after mount.
  useEffect(() => {
    if (!editable || recoveryChecked || !viewerUserId) return;
    const storage = getStorage();
    const exact = readLocalRecovery(
      storage,
      viewerUserId,
      open.gradebook.id,
      open.gradebook.revision,
    );
    let prompt: typeof recoveryPrompt = null;
    if (exact && exact.rows.length > 0) {
      prompt = {
        kind: "exact",
        rowCount: exact.rows.length,
        savedAt: exact.savedAt,
        revision: exact.revision,
      };
    } else {
      const stale = findStaleLocalRecovery(
        storage,
        viewerUserId,
        open.gradebook.id,
        open.gradebook.revision,
      );
      if (stale) {
        prompt = {
          kind: "stale",
          rowCount: stale.rows.length,
          savedAt: stale.savedAt,
          revision: stale.revision,
        };
      }
    }
    queueMicrotask(() => {
      setRecoveryPrompt(prompt);
      setRecoveryChecked(true);
    });
  }, [
    editable,
    recoveryChecked,
    viewerUserId,
    open.gradebook.id,
    open.gradebook.revision,
  ]);

  useEffect(() => {
    if (!editable || !dirty || !viewerUserId) return;
    writeLocalRecovery(
      getStorage(),
      buildRecoveryPayload(
        viewerUserId,
        open.gradebook.id,
        revision,
        rows.map((r) => ({
          student_id: r.student_id,
          entry_status: r.entry_status,
          marks_text: r.marks_text,
        })),
      ),
    );
  }, [dirty, editable, viewerUserId, open.gradebook.id, revision, rows]);

  useEffect(() => {
    if (!dirty || !editable) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, editable]);

  const updateRow = useCallback((studentId: string, next: EditableResultRow) => {
    setRows((prev) =>
      prev.map((r) => (r.student_id === studentId ? next : r)),
    );
    setMessage(null);
    setError(null);
    setSaveState((s) => (s === "conflict" || s === "restored" ? s : "unsaved"));
  }, []);

  function restoreLocal() {
    const storage = getStorage();
    const payload =
      recoveryPrompt?.kind === "stale"
        ? findStaleLocalRecovery(
            storage,
            viewerUserId,
            open.gradebook.id,
            revision,
          )
        : readLocalRecovery(
            storage,
            viewerUserId,
            open.gradebook.id,
            revision,
          );
    if (!payload) {
      setRecoveryPrompt(null);
      return;
    }
    if (payload.revision !== revision) {
      setSaveState("conflict");
      setError(
        "Local recovery is from a different revision. Server data stays loaded unless you discard recovery.",
      );
      setRecoveryPrompt(null);
      return;
    }
    const byId = new Map(payload.rows.map((r) => [r.student_id, r]));
    setRows((prev) =>
      prev.map((row) => {
        const recovered = byId.get(row.student_id);
        if (!recovered) return row;
        return {
          ...row,
          entry_status: recovered.entry_status,
          marks_text: recovered.marks_text,
          marks_obtained:
            recovered.marks_text.trim() === ""
              ? null
              : Number(recovered.marks_text),
        };
      }),
    );
    setSaveState("restored");
    setRecoveryPrompt(null);
  }

  function discardLocal() {
    clearLocalRecovery(getStorage(), viewerUserId, open.gradebook.id);
    setRecoveryPrompt(null);
  }

  function onSaveDraft() {
    if (!editable || pending) return;
    setError(null);
    setMessage(null);
    const payload = buildDraftPayloadRows(rows, maxMarks);
    if (!payload.ok) {
      setError(payload.message);
      firstInvalidRef.current = payload.firstInvalidStudentId ?? null;
      return;
    }
    setSaveState("saving");
    startTransition(async () => {
      const result = await saveExamGradebookDraftAction({
        gradebook_id: open.gradebook.id,
        expected_revision: revision,
        rows: payload.rows,
      });
      if (result.error !== null) {
        setSaveState(
          result.code === "REVISION_CONFLICT" ? "conflict" : "failed",
        );
        setError(result.error);
        return;
      }
      setRevision(result.revision);
      setLastSavedAt(new Date().toISOString());
      setBaseline(rows);
      clearLocalRecovery(getStorage(), viewerUserId, open.gradebook.id);
      setSaveState("saved");
      setMessage(`Draft saved (${result.saved_count} rows).`);
      router.refresh();
    });
  }

  function onSubmit() {
    if (!editable || pending) return;
    if (!reviewGate.ok) {
      setError(reviewGate.reason);
      return;
    }
    setSubmitConfirm(true);
  }

  function confirmSubmit() {
    setSubmitConfirm(false);
    setError(null);
    startTransition(async () => {
      const result = await submitExamGradebookAction({
        gradebook_id: open.gradebook.id,
        expected_revision: revision,
      });
      if (result.error !== null) {
        if (result.code === "REVISION_CONFLICT") setSaveState("conflict");
        if (result.code === "ROSTER_DRIFT" || result.code === "INCOMPLETE") {
          setError(result.error);
          router.refresh();
          return;
        }
        setError(result.error);
        return;
      }
      clearLocalRecovery(getStorage(), viewerUserId, open.gradebook.id);
      setMessage("Gradebook submitted.");
      router.push(`/dashboard/gradebook/${open.gradebook.id}`);
      router.refresh();
    });
  }

  function bulkStatus(status: "ABSENT" | "NOT_ASSESSED") {
    if (!editable) return;
    setRows((prev) =>
      prev.map((row) => {
        if (selected.size > 0 && !selected.has(row.student_id)) return row;
        const v = validateEditableRow(row, maxMarks);
        if (selected.size === 0 && v.ok && v.kind === "valid") return row;
        if (selected.size === 0 && !(v.ok && v.kind === "blank")) return row;
        return applyEntryStatus(row, status);
      }),
    );
    setSaveState((s) => (s === "conflict" ? s : "unsaved"));
  }

  function clearSelectedDraft() {
    if (!editable) return;
    setRows((prev) =>
      prev.map((row) => {
        if (selected.size > 0 && !selected.has(row.student_id)) return row;
        if (selected.size === 0) return row;
        return emptyEditableRow(row);
      }),
    );
    setClearConfirm(false);
    setSaveState((s) => (s === "conflict" ? s : "unsaved"));
  }

  function resetToServer() {
    setRows(baseline);
    setError(null);
    setMessage(null);
    setSaveState("saved");
    clearLocalRecovery(getStorage(), viewerUserId, open.gradebook.id, revision);
  }

  function focusMark(index: number) {
    const el = markRefs.current[index];
    if (!el) return;
    el.focus();
    el.select();
  }

  const saveLabel =
    displaySaveState === "saving"
      ? "Saving"
      : displaySaveState === "unsaved" || displaySaveState === "restored"
        ? "Unsaved changes"
        : displaySaveState === "failed"
          ? "Save failed"
          : displaySaveState === "conflict"
            ? "Revision conflict"
            : "All changes saved";

  return (
    <PageShell width="wide" className="pb-28">
      <PageHeader
        breadcrumb={<BackLink href="/dashboard/gradebook">Gradebook</BackLink>}
        title={`${labels.subject_name} · ${labels.class_name}`}
        description={
          <div className="space-y-1 text-sm">
            <p>
              {open.exam.exam_reference} · {labels.grade_name} · Max{" "}
              {maxMarks}
              {labels.exam_date ? ` · Exam ${labels.exam_date}` : ""}
            </p>
            <p>
              {labels.academic_year_name}
              {labels.term_name ? ` · ${labels.term_name}` : ""} · Revision{" "}
              {revision}
              {lastSavedAt
                ? ` · Last saved ${new Date(lastSavedAt).toLocaleString("en-ZM")}`
                : ""}
            </p>
          </div>
        }
        actions={<GradebookStatusBadge status={open.gradebook.status} />}
      />

      {open.gradebook.status === "REOPENED" ? (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">Reopened for correction</p>
          <p className="mt-1">
            Reason: {open.gradebook.reopening_reason ?? "—"}
          </p>
          {open.gradebook.submitted_at ? (
            <p className="mt-1 text-xs">
              Previously submitted{" "}
              {new Date(open.gradebook.submitted_at).toLocaleString("en-ZM")}
              {labels.submitted_by_name
                ? ` by ${labels.submitted_by_name}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {open.gradebook.status === "SUBMITTED" ? (
        <div
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
          role="status"
        >
          <p className="font-semibold">Submitted — read-only</p>
          <p className="mt-1">
            Submitted{" "}
            {open.gradebook.submitted_at
              ? new Date(open.gradebook.submitted_at).toLocaleString("en-ZM")
              : "—"}
            {labels.submitted_by_name
              ? ` by ${labels.submitted_by_name}`
              : ""}
          </p>
        </div>
      ) : null}

      {open.gradebook.status === "LOCKED" ? (
        <div
          className="rounded-xl border border-slate-400 bg-slate-100 px-4 py-3 text-sm text-slate-900"
          role="status"
        >
          <p className="font-semibold">Locked — final</p>
          <p className="mt-1">
            Locked{" "}
            {open.gradebook.locked_at
              ? new Date(open.gradebook.locked_at).toLocaleString("en-ZM")
              : "—"}
            {labels.locked_by_name ? ` by ${labels.locked_by_name}` : ""}. This
            gradebook cannot be reopened in Stage 1.
          </p>
        </div>
      ) : null}

      {(capabilities.can_reopen || capabilities.can_lock) &&
      open.gradebook.status === "SUBMITTED" ? (
        <div className="flex flex-wrap gap-2">
          <ReopenGradebookControls
            gradebookId={open.gradebook.id}
            expectedRevision={revision}
            canReopen={capabilities.can_reopen}
          />
          <LockGradebookControls
            gradebookId={open.gradebook.id}
            expectedRevision={revision}
            canLock={capabilities.can_lock}
          />
        </div>
      ) : null}

      {recoveryPrompt ? (
        <div
          className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm"
          role="alertdialog"
          aria-label="Local draft recovery"
        >
          <p className="font-semibold">
            {recoveryPrompt.kind === "stale"
              ? "Local draft from a different revision"
              : "Unsaved local draft found"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {recoveryPrompt.rowCount} row(s) · saved locally{" "}
            {new Date(recoveryPrompt.savedAt).toLocaleString("en-ZM")}
            {recoveryPrompt.kind === "stale"
              ? " · Server data is preferred when revisions differ."
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recoveryPrompt.kind === "exact" ? (
              <Button
                type="button"
                className="min-h-11"
                onClick={restoreLocal}
              >
                Restore local changes
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={discardLocal}
            >
              Discard local recovery
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No eligible students"
          description="There are no active enrolled students on this class roster for the exam, or all are excluded."
        />
      ) : (
        <>
          <section
            aria-label="Completion summary"
            className="grid gap-2 rounded-2xl border p-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <SummaryItem label="Eligible" value={summary.total} />
            <SummaryItem label="Completed" value={summary.completed} />
            <SummaryItem label="Missing" value={summary.missing} />
            <SummaryItem label="Invalid" value={summary.invalid} />
            <SummaryItem label="Scored" value={summary.scored} />
            <SummaryItem label="Absent" value={summary.absent} />
            <SummaryItem label="Exempt" value={summary.exempt} />
            <SummaryItem label="Not assessed" value={summary.not_assessed} />
            <SummaryItem
              label="Highest"
              value={summary.highest ?? "—"}
            />
            <SummaryItem label="Lowest" value={summary.lowest ?? "—"} />
            <SummaryItem
              label="Average (scored)"
              value={
                summary.average == null ? "—" : summary.average.toFixed(2)
              }
            />
          </section>

          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => bulkStatus("ABSENT")}
              >
                Mark blank as absent
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => bulkStatus("NOT_ASSESSED")}
              >
                Mark blank as not assessed
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={selected.size === 0}
                onClick={() => setClearConfirm(true)}
              >
                Clear selected
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={!dirty}
                onClick={resetToServer}
              >
                Discard unsaved changes
              </Button>
            </div>
          ) : null}

          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {editable ? <th className="px-3 py-3 w-10" /> : null}
                  <th className="px-3 py-3 w-12">#</th>
                  <th className="px-3 py-3">Admission</th>
                  <th className="px-3 py-3">Student</th>
                  <th className="px-3 py-3 w-28">Mark</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const validation = validateEditableRow(row, maxMarks);
                  const name = displayName(row);
                  return (
                    <tr
                      key={row.student_id}
                      className="border-b align-top"
                      data-invalid={!validation.ok || undefined}
                    >
                      {editable ? (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={selected.has(row.student_id)}
                            aria-label={`Select ${name}`}
                            onChange={(e) => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(row.student_id);
                                else next.delete(row.student_id);
                                return next;
                              });
                            }}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-3 tabular-nums text-muted-foreground">
                        {index + 1}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {row.admission_number}
                      </td>
                      <td className="px-3 py-3 font-medium">{name}</td>
                      <td className="px-3 py-3">
                        {editable ? (
                          <input
                            ref={(el) => {
                              markRefs.current[index] = el;
                            }}
                            type="text"
                            inputMode="decimal"
                            className="h-11 w-24 rounded-xl border bg-background px-2 tabular-nums"
                            aria-label={`Mark for ${name}`}
                            value={row.marks_text}
                            onChange={(e) =>
                              updateRow(
                                row.student_id,
                                applyMarkText(row, e.target.value),
                              )
                            }
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                focusMark(Math.min(index + 1, rows.length - 1));
                              }
                            }}
                          />
                        ) : (
                          <span className="tabular-nums">
                            {row.entry_status === "SCORED"
                              ? row.marks_text
                              : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {editable ? (
                          <StatusSelect
                            name={name}
                            value={row.entry_status}
                            onChange={(status) =>
                              updateRow(
                                row.student_id,
                                applyEntryStatus(row, status),
                              )
                            }
                          />
                        ) : (
                          <span>
                            {row.entry_status
                              ? RESULT_ENTRY_STATUS_LABELS[row.entry_status]
                              : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {!validation.ok ? (
                          <span className="text-destructive" role="alert">
                            {validation.message}
                          </span>
                        ) : validation.kind === "blank" ? (
                          <span className="text-muted-foreground">Blank</span>
                        ) : (
                          <span className="text-emerald-700">Valid</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row, index) => {
              const validation = validateEditableRow(row, maxMarks);
              const name = displayName(row);
              return (
                <li
                  key={row.student_id}
                  className="rounded-2xl border p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {index + 1}. {name}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.admission_number}
                      </p>
                    </div>
                    {editable ? (
                      <input
                        type="checkbox"
                        className="mt-1 size-5"
                        checked={selected.has(row.student_id)}
                        aria-label={`Select ${name}`}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.student_id);
                            else next.delete(row.student_id);
                            return next;
                          });
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-3">
                    {editable ? (
                      <>
                        <label className="block space-y-1 text-sm">
                          <span className="font-medium">Mark / {maxMarks}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="h-11 w-full rounded-xl border bg-background px-3 tabular-nums"
                            aria-label={`Mark for ${name}`}
                            value={row.marks_text}
                            onChange={(e) =>
                              updateRow(
                                row.student_id,
                                applyMarkText(row, e.target.value),
                              )
                            }
                          />
                        </label>
                        <StatusSelect
                          name={name}
                          value={row.entry_status}
                          onChange={(status) =>
                            updateRow(
                              row.student_id,
                              applyEntryStatus(row, status),
                            )
                          }
                        />
                      </>
                    ) : (
                      <p className="text-sm">
                        {row.entry_status
                          ? RESULT_ENTRY_STATUS_LABELS[row.entry_status]
                          : "—"}
                        {row.entry_status === "SCORED"
                          ? ` · ${row.marks_text} / ${maxMarks}`
                          : ""}
                      </p>
                    )}
                    {!validation.ok ? (
                      <p className="text-sm text-destructive" role="alert">
                        {validation.message}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-700" role="status">
          {message}
        </p>
      ) : null}

      {editable ? (
        <div className={cn(fixedFormFooterClass, "safe-area-pb")}>
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <StatusBadge
              tone={
                displaySaveState === "saved"
                  ? "success"
                  : displaySaveState === "conflict" ||
                      displaySaveState === "failed"
                    ? "danger"
                    : "warning"
              }
            >
              {saveLabel}
            </StatusBadge>
            <div className="flex flex-wrap gap-2">
              {displaySaveState === "conflict" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    clearLocalRecovery(getStorage(), viewerUserId, open.gradebook.id);
                    router.refresh();
                  }}
                >
                  Reload server data
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={pending || !dirty}
                onClick={onSaveDraft}
              >
                {pending && displaySaveState === "saving" ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={pending || !reviewGate.ok}
                title={
                  !reviewGate.ok ? reviewGate.reason : "Review before submit"
                }
                onClick={() => {
                  if (!reviewGate.ok) {
                    setError(reviewGate.reason);
                    return;
                  }
                  router.push(
                    `/dashboard/gradebook/${open.gradebook.id}/preview`,
                  );
                }}
              >
                Review and submit
              </Button>
            </div>
          </div>
        </div>
      ) : mode === "preview" &&
        (open.gradebook.status === "DRAFT" ||
          open.gradebook.status === "REOPENED") ? (
        <div className={cn(fixedFormFooterClass)}>
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Submission locks normal editing until an authorised reopen.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/dashboard/gradebook/${open.gradebook.id}`}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-11",
                )}
              >
                Back to edit
              </Link>
              <Button
                type="button"
                className="min-h-11"
                disabled={pending || dirty || !reviewGate.ok}
                onClick={onSubmit}
              >
                {pending ? "Submitting…" : "Submit gradebook"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={clearConfirm}
        title="Clear selected rows?"
        description="This clears marks and statuses for the selected students in your local draft. It does not delete saved server rows until you save."
        confirmLabel="Clear selected"
        tone="danger"
        onCancel={() => setClearConfirm(false)}
        onConfirm={clearSelectedDraft}
      />
      <ConfirmDialog
        open={submitConfirm}
        title="Submit gradebook?"
        description={SUBMIT_CONFIRMATION_TEXT}
        confirmLabel="Submit"
        pending={pending}
        onCancel={() => setSubmitConfirm(false)}
        onConfirm={confirmSubmit}
      />
    </PageShell>
  );
}

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatusSelect({
  name,
  value,
  onChange,
}: {
  name: string;
  value: ResultEntryStatus | null;
  onChange: (status: ResultEntryStatus) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Result status for ${name}`}
      className="flex flex-wrap gap-1.5"
    >
      {RESULT_ENTRY_STATUSES.map((status) => {
        const selected = value === status;
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(status)}
            className={cn(
              "min-h-11 rounded-xl border px-2.5 text-xs font-medium sm:text-sm",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background hover:bg-muted/50",
            )}
          >
            {RESULT_ENTRY_STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}
