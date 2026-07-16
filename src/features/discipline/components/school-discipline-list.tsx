"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  Search,
} from "lucide-react";

import { resolveDisciplineIncidentAction } from "@/features/discipline/actions";
import type { SchoolDisciplineIncidentRow } from "@/features/discipline/queries";
import {
  DisciplineSeverityBadge,
  DisciplineStatusBadge,
} from "@/features/discipline/components/discipline-badges";
import {
  DISCIPLINE_SEVERITIES,
  DISCIPLINE_SEVERITY_LABELS,
  type DisciplineSeverity,
  type DisciplineStatus,
} from "@/features/discipline/schemas";
import {
  SectionHeading,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { stickyHeaderClass, filterPanelClassName } from "@/components/ui/admin-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
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

interface SchoolDisciplineListProps {
  incidents: SchoolDisciplineIncidentRow[];
  canResolve: boolean;
  initialStatus: DisciplineStatus | "all";
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

function mostCommonRule(rows: SchoolDisciplineIncidentRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.relatedRuleTitle?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [title, count] of counts) {
    if (count > bestCount) {
      best = title;
      bestCount = count;
    }
  }
  return best || "—";
}

export function SchoolDisciplineList({
  incidents,
  canResolve,
  initialStatus,
}: SchoolDisciplineListProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<DisciplineStatus | "all">(
    initialStatus,
  );
  const [severityFilter, setSeverityFilter] = useState<
    DisciplineSeverity | "all"
  >("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ruleOptions = useMemo(() => {
    const titles = new Set<string>();
    for (const row of incidents) {
      if (row.relatedRuleTitle?.trim()) titles.add(row.relatedRuleTitle.trim());
    }
    return [...titles].sort((a, b) => a.localeCompare(b));
  }, [incidents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incidents.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (severityFilter !== "all" && row.severity !== severityFilter) {
        return false;
      }
      if (
        ruleFilter !== "all" &&
        (row.relatedRuleTitle?.trim() ?? "") !== ruleFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        row.studentName.toLowerCase().includes(q) ||
        row.admissionNumber.toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q) ||
        (row.relatedRuleTitle ?? "").toLowerCase().includes(q) ||
        (row.recordedByName ?? "").toLowerCase().includes(q)
      );
    });
  }, [incidents, ruleFilter, search, severityFilter, statusFilter]);

  const openIncidents = incidents.filter((i) => i.status === "open");
  const resolvedIncidents = incidents.filter((i) => i.status === "resolved");
  const highSeverity = incidents.filter((i) => i.severity === "high");
  const followUpsDue = openIncidents.filter((i) => !i.actionTaken.trim());
  const needsAttention = openIncidents.filter(
    (i) => i.severity === "high" || !i.actionTaken.trim(),
  );
  const recent = [...incidents].slice(0, 5);
  const commonRule = mostCommonRule(incidents);

  const selected =
    filtered.find((i) => i.id === selectedId) ??
    incidents.find((i) => i.id === selectedId) ??
    null;

  function onResolve(incident: SchoolDisciplineIncidentRow) {
    setError(null);
    setPendingId(incident.id);
    startTransition(async () => {
      const result = await resolveDisciplineIncidentAction({
        incidentId: incident.id,
        studentId: incident.studentId,
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Open incidents"
          value={String(openIncidents.length)}
          hint="Awaiting resolution"
          icon={FolderOpen}
          tone={openIncidents.length > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Resolved incidents"
          value={String(resolvedIncidents.length)}
          hint="In the loaded list"
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          title="High-severity"
          value={String(highSeverity.length)}
          hint="Open or resolved"
          icon={AlertTriangle}
          tone={highSeverity.length > 0 ? "danger" : "success"}
        />
        <StatCard
          title="Follow-ups due"
          value={String(followUpsDue.length)}
          hint="Open cases with no action recorded yet"
          icon={ClipboardList}
          tone={followUpsDue.length > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cases requiring attention</CardTitle>
            <CardDescription>
              High severity or open with no action taken yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {needsAttention.length === 0 ? (
              <EmptyState
                title="Nothing needs attention"
                description="No high-severity or incomplete open cases in the loaded list."
                size="sm"
              />
            ) : (
              <ul className="space-y-2">
                {needsAttention.slice(0, 6).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(row.id);
                        setResolveNotes(row.actionTaken);
                      }}
                      className="flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="font-medium">{row.studentName}</span>
                      <span className="text-sm text-muted-foreground">
                        {row.title}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <DisciplineSeverityBadge severity={row.severity} />
                        <DisciplineStatusBadge status={row.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent incidents</CardTitle>
            <CardDescription>
              Most common rule breached:{" "}
              <span className="font-medium text-foreground">{commonRule}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                title="No discipline incidents"
                description="Record incidents from a student profile. They will appear here for the whole school."
                size="sm"
              />
            ) : (
              <ul className="space-y-2">
                {recent.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.studentName}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {formatDate(row.incidentDate)} · {row.title}
                      </p>
                    </div>
                    <DisciplineStatusBadge status={row.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Incident list</CardTitle>
          <CardDescription>
            Search and filter the loaded cases. Open a row for case details and
            resolution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="search"
            aria-label="Incident filters"
            className={filterPanelClassName()}
          >
            <div className="relative space-y-1.5 sm:col-span-2 lg:col-span-2">
              <Label htmlFor="incident-search">Search</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="incident-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Student, admission #, incident, rule…"
                  className="h-11 pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-filter">Status</Label>
              <SelectNative
                id="status-filter"
                value={statusFilter}
                onChange={(event) => {
                  const value = event.target.value as DisciplineStatus | "all";
                  setStatusFilter(value);
                  router.replace(
                    value === "open"
                      ? "/dashboard/discipline?status=open"
                      : `/dashboard/discipline?status=${value}`,
                    { scroll: false },
                  );
                }}
                className="h-11"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </SelectNative>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="severity-filter">Severity</Label>
              <SelectNative
                id="severity-filter"
                value={severityFilter}
                onChange={(event) =>
                  setSeverityFilter(
                    event.target.value as DisciplineSeverity | "all",
                  )
                }
                className="h-11"
              >
                <option value="all">All severities</option>
                {DISCIPLINE_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {DISCIPLINE_SEVERITY_LABELS[value]}
                  </option>
                ))}
              </SelectNative>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="rule-filter">Rule</Label>
              <SelectNative
                id="rule-filter"
                value={ruleFilter}
                onChange={(event) => setRuleFilter(event.target.value)}
                className="h-11"
              >
                <option value="all">All rules</option>
                {ruleOptions.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </SelectNative>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={
                incidents.length === 0
                  ? "No discipline incidents"
                  : "No results for current filters"
              }
              description={
                incidents.length === 0
                  ? "When teachers record incidents on student profiles, they appear here."
                  : "Try clearing search or changing status, severity, or rule filters."
              }
              size="sm"
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Showing {filtered.length} of {incidents.length}
              </p>

              {/* Desktop table */}
              <div className="hidden max-h-[min(70vh,40rem)] overflow-auto rounded-xl border shadow-sm md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Incident / rule</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reported by</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((incident) => (
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
                          <Link
                            href={`/dashboard/students/${incident.studentId}`}
                            className="font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {incident.studentName}
                          </Link>
                          <p className="font-mono text-xs text-muted-foreground">
                            {incident.admissionNumber}
                          </p>
                        </TableCell>
                        <TableCell className="align-top">
                          <p className="font-medium">{incident.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {incident.relatedRuleTitle ?? "No linked rule"}
                          </p>
                        </TableCell>
                        <TableCell className="align-top">
                          <DisciplineSeverityBadge
                            severity={incident.severity}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <DisciplineStatusBadge status={incident.status} />
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {incident.recordedByName ?? "—"}
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-10"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(incident.id);
                              setResolveNotes(incident.actionTaken);
                            }}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <ul className="space-y-3 md:hidden">
                {filtered.map((incident) => (
                  <li key={incident.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(incident.id);
                        setResolveNotes(incident.actionTaken);
                      }}
                      className={cn(
                        "w-full space-y-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        selectedId === incident.id && "border-ring bg-muted/30",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{incident.studentName}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {incident.admissionNumber}
                          </p>
                        </div>
                        <DisciplineStatusBadge status={incident.status} />
                      </div>
                      <p className="font-medium">{incident.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(incident.incidentDate)}
                        {incident.relatedRuleTitle
                          ? ` · ${incident.relatedRuleTitle}`
                          : ""}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <DisciplineSeverityBadge severity={incident.severity} />
                        <StatusBadge tone="neutral">
                          {incident.recordedByName
                            ? `By ${incident.recordedByName}`
                            : "Reporter unknown"}
                        </StatusBadge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {selected ? (
        <Card className="shadow-sm" id="incident-case">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Case detail</CardTitle>
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
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-3 rounded-xl border p-4">
                <SectionHeading title="Student summary" />
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd>
                      <Link
                        href={`/dashboard/students/${selected.studentId}`}
                        className="font-medium hover:underline"
                      >
                        {selected.studentName}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Admission number</dt>
                    <dd className="font-mono">{selected.admissionNumber}</dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-3 rounded-xl border p-4">
                <SectionHeading title="Incident details" />
                <dl className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <DisciplineSeverityBadge severity={selected.severity} />
                    <DisciplineStatusBadge status={selected.status} />
                  </div>
                  <div>
                    <dt className="text-muted-foreground">What happened</dt>
                    <dd className="whitespace-pre-wrap">
                      {selected.description || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reported by</dt>
                    <dd>{selected.recordedByName ?? "—"}</dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-3 rounded-xl border p-4">
                <SectionHeading title="Rule information" />
                <p className="text-sm">
                  {selected.relatedRuleTitle ?? "No school rule linked"}
                </p>
              </section>

              <section className="space-y-3 rounded-xl border p-4">
                <SectionHeading
                  title="Action & follow-up"
                  description="Follow-up dates are not stored on incidents yet — use action notes for next steps."
                />
                <p className="text-sm whitespace-pre-wrap">
                  {selected.actionTaken || "No action recorded yet."}
                </p>
              </section>
            </div>

            <section className="space-y-3 rounded-xl border border-dashed p-4">
              <SectionHeading title="Resolution" />
              {selected.status === "resolved" ? (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Current status</dt>
                    <dd>
                      <DisciplineStatusBadge status={selected.status} />
                    </dd>
                  </div>
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
                    <Label htmlFor="resolve-notes">
                      Final action / resolution notes
                    </Label>
                    <textarea
                      id="resolve-notes"
                      value={resolveNotes}
                      onChange={(event) => setResolveNotes(event.target.value)}
                      rows={3}
                      placeholder="Summarise the outcome and any parent contact"
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
                  This case is still open. Only office roles can resolve it.
                </p>
              )}
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
