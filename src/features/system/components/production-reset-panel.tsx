"use client";

import { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import {
  previewProductionResetAction,
  executeProductionResetAction,
} from "@/features/system/actions";
import {
  PRODUCTION_RESET_CONFIRMATION,
  PRODUCTION_RESET_SCHOOL_NAME,
  type ProductionResetCounts,
  type ProductionResetResult,
} from "@/features/system/production-reset-schemas";
import { SectionHeading } from "@/components/layout/page-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DELETE_LABELS: { key: keyof ProductionResetCounts; label: string }[] = [
  { key: "students", label: "Students" },
  { key: "applications", label: "Applications" },
  { key: "guardians", label: "Guardians" },
  { key: "charges", label: "Charges" },
  { key: "payments", label: "Payments / receipts" },
  { key: "attendance_records", label: "Attendance records" },
  { key: "attendance_record_audits", label: "Attendance audits" },
  { key: "discipline_incidents", label: "Discipline incidents" },
  { key: "student_requirement_checks", label: "Requirement checks" },
  { key: "student_medical", label: "Medical records" },
  { key: "student_class_enrollments", label: "Class placements" },
  { key: "student_guardians", label: "Guardian links" },
  { key: "legacy_migration_audits", label: "Legacy migration audits" },
  { key: "class_attendance_covers", label: "Attendance covers" },
];

export function ProductionResetPanel({ enabled }: { enabled: boolean }) {
  const [understood, setUnderstood] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [dryRun, setDryRun] = useState<ProductionResetResult | null>(null);
  const [result, setResult] = useState<ProductionResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canDryRun =
    enabled &&
    understood &&
    schoolName === PRODUCTION_RESET_SCHOOL_NAME &&
    confirmation === PRODUCTION_RESET_CONFIRMATION &&
    !pending;

  const canExecute = canDryRun && dryRun?.mode === "dry_run" && !result;

  async function runDryRun() {
    setError(null);
    setResult(null);
    setDryRun(null);
    setPending(true);
    try {
      const response = await previewProductionResetAction({
        schoolName,
        confirmation,
        understood: true as const,
      });
      if (response.error) {
        setError(response.error);
        return;
      }
      setDryRun(response.result);
    } finally {
      setPending(false);
    }
  }

  async function runExecute() {
    setError(null);
    setPending(true);
    setConfirmOpen(false);
    try {
      const response = await executeProductionResetAction({
        schoolName,
        confirmation,
        understood: true as const,
      });
      if (response.error) {
        setError(response.error);
        return;
      }
      setResult(response.result);
      setDryRun(null);
    } finally {
      setPending(false);
    }
  }

  if (!enabled) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden />
            Production Reset unavailable
          </CardTitle>
          <CardDescription>
            This control is disabled. Set the server environment variable{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              ALLOW_PRODUCTION_RESET=true
            </code>{" "}
            only when you are ready to wipe test operational data, then remove
            it after the reset.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (result?.mode === "executed") {
    const deleted = result.deleted;
    return (
      <div className="space-y-6">
        <Card className="border-emerald-300 shadow-sm dark:border-emerald-800">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Reset complete</CardTitle>
              <StatusBadge tone="success">Success</StatusBadge>
            </div>
            <CardDescription>
              Test operational data has been permanently removed. Staff,
              authentication, and school configuration remain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.reminder ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                {result.reminder}
              </p>
            ) : null}
            {deleted ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Students deleted" value={String(deleted.students)} />
                <StatCard
                  title="Payments deleted"
                  value={String(deleted.payments)}
                />
                <StatCard
                  title="Charges deleted"
                  value={String(deleted.charges)}
                />
                <StatCard
                  title="Applications deleted"
                  value={String(deleted.applications)}
                />
              </div>
            ) : null}
            <SectionHeading
              title="Validation"
              description="Operational tables must be zero; staff and configuration remain."
            />
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(result.validation ?? {}).map(([key, value]) => (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span className="text-muted-foreground">{key}</span>
                  <span className="font-medium tabular-nums">
                    {String(value)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  const counts = dryRun?.to_delete;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Preserved</CardTitle>
            <CardDescription>These records will not be deleted.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Staff and user accounts</li>
              <li>Roles and permissions</li>
              <li>School settings</li>
              <li>Academic years and terms</li>
              <li>Grades and classes</li>
              <li>Fee structures and optional charge definitions</li>
              <li>Rules and requirements catalogues</li>
            </ul>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Deleted</CardTitle>
            <CardDescription>
              Test operational data removed permanently.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Test students, guardians, and applications</li>
              <li>Test charges, payments, and receipts</li>
              <li>Test attendance and discipline</li>
              <li>Student notes, medical, and requirement checks</li>
              <li>Related operational audit records</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-300 shadow-sm dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-amber-700 dark:text-amber-300"
              aria-hidden
            />
            Confirmation required
          </CardTitle>
          <CardDescription>
            This permanently removes test operational data while preserving
            staff, authentication, school configuration, academic setup, fee
            setup, and system settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={understood}
              onChange={(event) => {
                setUnderstood(event.target.checked);
                setDryRun(null);
              }}
            />
            <span>I understand this action is permanent.</span>
          </label>

          <div className="space-y-2">
            <Label htmlFor="reset-school-name">
              Type school name: {PRODUCTION_RESET_SCHOOL_NAME}
            </Label>
            <Input
              id="reset-school-name"
              value={schoolName}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setSchoolName(event.target.value);
                setDryRun(null);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-confirmation">
              Type confirmation: {PRODUCTION_RESET_CONFIRMATION}
            </Label>
            <Input
              id="reset-confirmation"
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setDryRun(null);
              }}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={!canDryRun}
              onClick={() => void runDryRun()}
            >
              {pending && !confirmOpen ? "Running dry run…" : "Run Dry Run"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={!canExecute || pending}
              onClick={() => setConfirmOpen(true)}
            >
              Permanently Delete Test Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {counts ? (
        <div className="space-y-4">
          <SectionHeading
            title="Dry-run preview"
            description="No data was deleted. Review counts before executing."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Students" value={String(counts.students)} tone="warning" />
            <StatCard
              title="Applications"
              value={String(counts.applications)}
              tone="warning"
            />
            <StatCard
              title="Charges"
              value={String(counts.charges)}
              tone="danger"
            />
            <StatCard
              title="Payments"
              value={String(counts.payments)}
              tone="danger"
            />
          </div>
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                {DELETE_LABELS.map(({ key, label }) => (
                  <li
                    key={key}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums">
                      {counts[key]}
                    </span>
                  </li>
                ))}
              </ul>
              {dryRun?.storage_note ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  {dryRun.storage_note}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Permanently delete test operational data?"
        description="This cannot be undone. Staff accounts, academic setup, fee catalogues, and school settings will be preserved. All test students, payments, attendance, and discipline will be removed."
        confirmLabel="Delete permanently"
        tone="danger"
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runExecute()}
      />
    </div>
  );
}
