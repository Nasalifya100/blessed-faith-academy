"use client";

import Link from "next/link";

import type { FeeBalanceRow } from "@/features/reports/queries";
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
import { formatKwacha, toNgwee } from "@/lib/money";
import { cn } from "@/lib/utils";

function balanceStatus(row: FeeBalanceRow): {
  label: string;
  tone: "success" | "warning" | "danger";
} {
  const balance = toNgwee(row.balance);
  const charged = toNgwee(row.totalCharged);
  if (balance <= 0) return { label: "Paid", tone: "success" };
  if (charged > 0 && toNgwee(row.totalPaid) > 0) {
    return { label: "Partial", tone: "warning" };
  }
  return { label: "Outstanding", tone: "danger" };
}

function matchesFeeRow(row: FeeBalanceRow, query: string): boolean {
  return (
    row.fullName.toLowerCase().includes(query) ||
    row.admissionNumber.toLowerCase().includes(query) ||
    (row.className ?? "").toLowerCase().includes(query)
  );
}

export function FeeBalancesReportTable({ rows }: { rows: FeeBalanceRow[] }) {
  const table = useClientPagedList(rows, matchesFeeRow);

  return (
    <div className="space-y-3">
      <ReportTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search student, admission #, or class"
        resultCount={table.filteredCount}
        totalCount={table.totalCount}
      />

      {/* Desktop */}
      <ReportTableShell className="hidden md:block">
        <Table>
          <TableHeader className={stickyHeaderClass}>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Charged</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageItems.map((row) => {
              const status = balanceStatus(row);
              return (
                <TableRow key={row.studentId}>
                  <TableCell>
                    <Link
                      href={`/dashboard/students/${row.studentId}`}
                      className="font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {row.fullName}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">
                      {row.admissionNumber}
                    </p>
                  </TableCell>
                  <TableCell>{row.className ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(row.totalCharged)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwacha(row.totalPaid)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      status.tone === "danger" &&
                        "text-red-700 dark:text-red-300",
                      status.tone === "warning" &&
                        "text-amber-800 dark:text-amber-200",
                      status.tone === "success" &&
                        "text-emerald-700 dark:text-emerald-300",
                    )}
                  >
                    {formatKwacha(row.balance)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ReportTableShell>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {table.pageItems.map((row) => {
          const status = balanceStatus(row);
          return (
            <li
              key={row.studentId}
              className="space-y-2 rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/students/${row.studentId}`}
                    className="font-medium hover:underline"
                  >
                    {row.fullName}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.admissionNumber}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.className ?? "—"}
                  </p>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Charged</dt>
                  <dd className="tabular-nums">
                    {formatKwacha(row.totalCharged)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Paid</dt>
                  <dd className="tabular-nums">
                    {formatKwacha(row.totalPaid)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Balance</dt>
                  <dd className="font-medium tabular-nums">
                    {formatKwacha(row.balance)}
                  </dd>
                </div>
              </dl>
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
