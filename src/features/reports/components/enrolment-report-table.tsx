"use client";

import type { EnrolmentByClassRow } from "@/features/reports/queries";
import {
  ReportPagination,
  ReportTableToolbar,
  useClientPagedList,
} from "@/features/reports/components/report-table-controls";
import { ReportTableShell } from "@/features/reports/components/report-table-shell";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function capacityStatus(
  enrolled: number,
  capacity: number | null,
): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (capacity == null) return { label: "Open", tone: "neutral" };
  if (enrolled >= capacity) return { label: "Full", tone: "danger" };
  if (enrolled >= capacity * 0.9) return { label: "Near full", tone: "warning" };
  return { label: "Available", tone: "success" };
}

function matchesEnrolmentRow(row: EnrolmentByClassRow, query: string): boolean {
  return row.className.toLowerCase().includes(query);
}

export function EnrolmentReportTable({ rows }: { rows: EnrolmentByClassRow[] }) {
  const table = useClientPagedList(rows, matchesEnrolmentRow, 50);

  return (
    <div className="space-y-3">
      <ReportTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search class"
        resultCount={table.filteredCount}
        totalCount={table.totalCount}
      />

      <ReportTableShell className="hidden md:block">
        <Table>
          <TableHeader className={stickyHeaderClass}>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Enrolled</TableHead>
              <TableHead className="text-right">Capacity</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageItems.map((row) => {
              const status = capacityStatus(row.enrolledCount, row.capacity);
              return (
                <TableRow key={row.classId}>
                  <TableCell className="font-medium">{row.className}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.enrolledCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.capacity ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ReportTableShell>

      <ul className="space-y-3 md:hidden">
        {table.pageItems.map((row) => {
          const status = capacityStatus(row.enrolledCount, row.capacity);
          return (
            <li
              key={row.classId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm"
            >
              <div>
                <p className="font-medium">{row.className}</p>
                <p className="text-sm text-muted-foreground">
                  {row.enrolledCount} enrolled
                  {row.capacity != null ? ` / ${row.capacity}` : ""}
                </p>
              </div>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </li>
          );
        })}
      </ul>

      <ReportPagination
        page={table.page}
        pageCount={table.pageCount}
        onPageChange={table.setPage}
      />
    </div>
  );
}
