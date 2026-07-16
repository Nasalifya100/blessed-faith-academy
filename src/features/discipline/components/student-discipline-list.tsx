"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { resolveDisciplineIncidentAction } from "@/features/discipline/actions";
import type { DisciplineIncidentRow } from "@/features/discipline/queries";
import {
  DisciplineSeverityBadge,
  DisciplineStatusBadge,
} from "@/features/discipline/components/discipline-badges";
import { SectionHeading } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface StudentDisciplineListProps {
  studentId: string;
  incidents: DisciplineIncidentRow[];
  canResolve: boolean;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) return value;
    return fallback.toLocaleDateString("en-ZM", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StudentDisciplineList({
  studentId,
  incidents,
  canResolve,
}: StudentDisciplineListProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openCount = incidents.filter((i) => i.status === "open").length;
  const selected = incidents.find((i) => i.id === selectedId) ?? null;

  function onResolve(incident: DisciplineIncidentRow) {
    setError(null);
    setPendingId(incident.id);
    startTransition(async () => {
      const result = await resolveDisciplineIncidentAction({
        incidentId: incident.id,
        studentId,
        actionTaken: resolveNotes.trim() || incident.actionTaken,
      });
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setResolveNotes("");
      setSelectedId(null);
      router.refresh();
    });
  }

  if (incidents.length === 0) {
    return (
      <EmptyState
        title="No discipline incidents"
        description="No behaviour incidents have been recorded for this student yet."
        size="sm"
        icon={
          <AlertTriangle
            className="size-6 text-muted-foreground"
            aria-hidden
          />
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {incidents.length} incident{incidents.length === 1 ? "" : "s"}
        {openCount > 0 ? ` · ${openCount} open` : ""}
      </p>

      <div className="hidden max-h-[min(50vh,28rem)] overflow-auto rounded-xl border shadow-sm md:block">
        <Table>
          <TableHeader className={stickyHeaderClass}>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Incident</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((incident) => (
              <TableRow
                key={incident.id}
                className={cn(
                  "cursor-pointer",
                  selectedId === incident.id && "bg-muted/50",
                )}
                onClick={() => {
                  setSelectedId(incident.id);
                  setResolveNotes(incident.actionTaken);
                }}
              >
                <TableCell className="whitespace-nowrap align-top">
                  {formatDate(incident.incidentDate)}
                </TableCell>
                <TableCell className="align-top">
                  <p className="font-medium">{incident.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {incident.relatedRuleTitle ?? "No linked rule"}
                  </p>
                </TableCell>
                <TableCell className="align-top">
                  <DisciplineSeverityBadge severity={incident.severity} />
                </TableCell>
                <TableCell className="align-top">
                  <DisciplineStatusBadge status={incident.status} />
                </TableCell>
                <TableCell className="align-top text-right">
                  <Button type="button" variant="ghost" size="sm">
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {incidents.map((incident) => (
          <li key={incident.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedId(incident.id);
                setResolveNotes(incident.actionTaken);
              }}
              className={cn(
                "w-full space-y-2 rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selectedId === incident.id && "border-ring bg-muted/30",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{incident.title}</p>
                <DisciplineStatusBadge status={incident.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDate(incident.incidentDate)}
              </p>
              <DisciplineSeverityBadge severity={incident.severity} />
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Case detail</CardTitle>
              <CardDescription>
                {selected.title} · {formatDate(selected.incidentDate)}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedId(null)}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="space-y-2 rounded-xl border p-3">
                <SectionHeading title="Incident details" />
                <div className="flex flex-wrap gap-2">
                  <DisciplineSeverityBadge severity={selected.severity} />
                  <DisciplineStatusBadge status={selected.status} />
                </div>
                <p className="text-sm whitespace-pre-wrap">
                  {selected.description || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reported by {selected.recordedByName ?? "—"}
                </p>
              </section>
              <section className="space-y-2 rounded-xl border p-3">
                <SectionHeading title="Rule & action" />
                <p className="text-sm">
                  {selected.relatedRuleTitle ?? "No school rule linked"}
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {selected.actionTaken || "No action recorded yet."}
                </p>
              </section>
            </div>

            <section className="space-y-3 rounded-xl border border-dashed p-3">
              <SectionHeading title="Resolution" />
              {selected.status === "resolved" ? (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Resolved date</dt>
                    <dd>
                      {selected.resolvedAt
                        ? formatWhen(selected.resolvedAt)
                        : "—"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Final action</dt>
                    <dd className="whitespace-pre-wrap">
                      {selected.actionTaken || "—"}
                    </dd>
                  </div>
                </dl>
              ) : canResolve ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`resolve-${selected.id}`}>
                      Final action / resolution notes
                    </Label>
                    <textarea
                      id={`resolve-${selected.id}`}
                      value={resolveNotes}
                      onChange={(event) => setResolveNotes(event.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </div>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={isPending && pendingId === selected.id}
                    onClick={() => onResolve(selected)}
                  >
                    {isPending && pendingId === selected.id
                      ? "Resolving…"
                      : "Mark resolved"}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This case is still open.
                </p>
              )}
            </section>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
