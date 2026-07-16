"use client";

import Link from "next/link";

import type { ClassAttendanceSummaryRow } from "@/features/reports/queries";
import {
  ReportPagination,
  ReportTableToolbar,
  useClientPagedList,
} from "@/features/reports/components/report-table-controls";
import { ReportTableShell } from "@/features/reports/components/report-table-shell";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function rateTone(
  rate: number,
  hasMarks: boolean,
): "success" | "warning" | "danger" | "neutral" {
  if (!hasMarks) return "neutral";
  if (rate >= 90) return "success";
  if (rate >= 75) return "warning";
  return "danger";
}

function matchesAttendanceRow(
  row: ClassAttendanceSummaryRow,
  query: string,
): boolean {
  return row.className.toLowerCase().includes(query);
}

export function AttendanceReportTable({
  rows,
}: {
  rows: ClassAttendanceSummaryRow[];
}) {
  const table = useClientPagedList(rows, matchesAttendanceRow, 50);

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
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Late</TableHead>
              <TableHead className="text-right">Excused</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="print:hidden" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageItems.map((row) => (
              <TableRow key={row.classId}>
                <TableCell className="font-medium">{row.className}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.daysRecorded}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.present}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.absent}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.late}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.excused}
                </TableCell>
                <TableCell className="text-right">
                  {row.totalMarks === 0 ? (
                    <StatusBadge tone="neutral">—</StatusBadge>
                  ) : (
                    <StatusBadge
                      tone={rateTone(row.attendanceRate, true)}
                    >{`${row.attendanceRate}%`}</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-right print:hidden">
                  <Link
                    href={`/dashboard/attendance/${row.classId}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                    )}
                  >
                    Register
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportTableShell>

      <ul className="space-y-3 md:hidden">
        {table.pageItems.map((row) => (
          <li
            key={row.classId}
            className="space-y-2 rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">{row.className}</p>
              {row.totalMarks === 0 ? (
                <StatusBadge tone="neutral">No marks</StatusBadge>
              ) : (
                <StatusBadge tone={rateTone(row.attendanceRate, true)}>
                  {row.attendanceRate}%
                </StatusBadge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {row.daysRecorded} days · {row.present} present · {row.absent}{" "}
              absent · {row.late} late · {row.excused} excused
            </p>
            <Link
              href={`/dashboard/attendance/${row.classId}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "print:hidden",
              )}
            >
              Open register
            </Link>
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
