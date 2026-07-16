"use client";

import Link from "next/link";

import type { SchoolDisciplineIncidentRow } from "@/features/discipline/queries";
import {
  DisciplineSeverityBadge,
  DisciplineStatusBadge,
} from "@/features/discipline/components/discipline-badges";
import type {
  DisciplineSeverity,
  DisciplineStatus,
} from "@/features/discipline/schemas";
import {
  ReportPagination,
  ReportTableToolbar,
  useClientPagedList,
} from "@/features/reports/components/report-table-controls";
import { ReportTableShell } from "@/features/reports/components/report-table-shell";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDay(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZM", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function matchesIncident(
  row: SchoolDisciplineIncidentRow,
  query: string,
): boolean {
  return (
    row.studentName.toLowerCase().includes(query) ||
    row.admissionNumber.toLowerCase().includes(query) ||
    row.title.toLowerCase().includes(query) ||
    (row.relatedRuleTitle ?? "").toLowerCase().includes(query)
  );
}

export function DisciplineReportTable({
  rows,
}: {
  rows: SchoolDisciplineIncidentRow[];
}) {
  const table = useClientPagedList(rows, matchesIncident);

  return (
    <div className="space-y-3">
      <ReportTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search student, incident, or rule"
        resultCount={table.filteredCount}
        totalCount={table.totalCount}
      />

      <ReportTableShell className="hidden md:block">
        <Table>
          <TableHeader className={stickyHeaderClass}>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Incident</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageItems.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">
                  {formatDay(row.incidentDate)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/students/${row.studentId}`}
                    className="font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {row.studentName}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.admissionNumber}
                  </p>
                </TableCell>
                <TableCell>
                  <p className="font-medium">{row.title}</p>
                  {row.relatedRuleTitle ? (
                    <p className="text-xs text-muted-foreground">
                      {row.relatedRuleTitle}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <DisciplineSeverityBadge
                    severity={row.severity as DisciplineSeverity}
                  />
                </TableCell>
                <TableCell>
                  <DisciplineStatusBadge
                    status={row.status as DisciplineStatus}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportTableShell>

      <ul className="space-y-3 md:hidden">
        {table.pageItems.map((row) => (
          <li
            key={row.id}
            className="space-y-2 rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{row.title}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDay(row.incidentDate)}
                </p>
              </div>
              <DisciplineStatusBadge
                status={row.status as DisciplineStatus}
              />
            </div>
            <Link
              href={`/dashboard/students/${row.studentId}`}
              className="text-sm font-medium hover:underline"
            >
              {row.studentName}
            </Link>
            <DisciplineSeverityBadge
              severity={row.severity as DisciplineSeverity}
            />
          </li>
        ))}
      </ul>

      <ReportPagination
        page={table.page}
        pageCount={table.pageCount}
        onPageChange={table.setPage}
      />
    </div>
  );
}
