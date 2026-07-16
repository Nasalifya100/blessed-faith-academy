"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { StudentStatusBadge } from "@/features/students/components/status-badge";
import { StudentAvatar } from "@/features/students/components/student-avatar";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export interface StudentsTableRow {
  id: string;
  admissionNumber: string;
  fullName: string;
  className: string | null;
  status: string;
}

export function StudentsTable({ students }: { students: StudentsTableRow[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));

  const pageIndex = Math.min(page, totalPages - 1);
  const slice = useMemo(() => {
    const start = pageIndex * PAGE_SIZE;
    return students.slice(start, start + PAGE_SIZE);
  }, [students, pageIndex]);

  const from = students.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const to = Math.min(students.length, (pageIndex + 1) * PAGE_SIZE);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="relative max-h-[min(70vh,40rem)] overflow-auto">
        <Table>
          <TableHeader className={stickyHeaderClass}>
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>Admission #</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((student) => (
              <TableRow
                key={student.id}
                className="group transition-colors hover:bg-muted/40"
              >
                <TableCell>
                  <StudentAvatar name={student.fullName} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {student.admissionNumber}
                </TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/students/${student.id}`}
                    className="hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {student.fullName}
                  </Link>
                </TableCell>
                <TableCell>{student.className ?? "—"}</TableCell>
                <TableCell>
                  <StudentStatusBadge status={student.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/dashboard/students/${student.id}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "opacity-80 group-hover:opacity-100",
                    )}
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Showing{" "}
          <span className="font-medium text-foreground">
            {from}–{to}
          </span>{" "}
          of{" "}
          <span className="font-medium text-foreground">{students.length}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageIndex <= 0}
            aria-label="Previous page"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <span className="min-w-20 text-center text-sm text-muted-foreground">
            Page {pageIndex + 1} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageIndex >= totalPages - 1}
            aria-label="Next page"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
