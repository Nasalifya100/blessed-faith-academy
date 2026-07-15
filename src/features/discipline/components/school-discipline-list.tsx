"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { resolveDisciplineIncidentAction } from "@/features/discipline/actions";
import type { SchoolDisciplineIncidentRow } from "@/features/discipline/queries";
import {
  DISCIPLINE_SEVERITY_LABELS,
  DISCIPLINE_STATUS_LABELS,
} from "@/features/discipline/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SchoolDisciplineListProps {
  incidents: SchoolDisciplineIncidentRow[];
  canResolve: boolean;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SchoolDisciplineList({
  incidents,
  canResolve,
}: SchoolDisciplineListProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onResolve(incident: SchoolDisciplineIncidentRow) {
    setError(null);
    setPendingId(incident.id);
    startTransition(async () => {
      const result = await resolveDisciplineIncidentAction({
        incidentId: incident.id,
        studentId: incident.studentId,
        actionTaken: incident.actionTaken,
      });
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (incidents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No incidents match this filter.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Incident</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              {canResolve ? <TableHead className="w-28" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((incident) => (
              <TableRow key={incident.id}>
                <TableCell className="whitespace-nowrap align-top">
                  {formatDate(incident.incidentDate)}
                </TableCell>
                <TableCell className="align-top">
                  <Link
                    href={`/dashboard/students/${incident.studentId}`}
                    className="font-medium hover:underline"
                  >
                    {incident.studentName}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {incident.admissionNumber}
                  </p>
                </TableCell>
                <TableCell className="align-top">
                  <p className="font-medium">{incident.title}</p>
                  {incident.relatedRuleTitle ? (
                    <p className="text-xs text-muted-foreground">
                      Rule: {incident.relatedRuleTitle}
                    </p>
                  ) : null}
                  {incident.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {incident.description}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">
                  <Badge
                    variant={
                      incident.severity === "high"
                        ? "destructive"
                        : incident.severity === "medium"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {DISCIPLINE_SEVERITY_LABELS[incident.severity]}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  <Badge
                    variant={
                      incident.status === "open" ? "outline" : "secondary"
                    }
                  >
                    {DISCIPLINE_STATUS_LABELS[incident.status]}
                  </Badge>
                </TableCell>
                {canResolve ? (
                  <TableCell className="align-top text-right">
                    {incident.status === "open" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending && pendingId === incident.id}
                        onClick={() => onResolve(incident)}
                      >
                        {isPending && pendingId === incident.id
                          ? "…"
                          : "Resolve"}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
