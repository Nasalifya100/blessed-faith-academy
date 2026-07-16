"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Search,
  UserRound,
} from "lucide-react";

import type { ApplicationListItem } from "@/features/applications/queries";
import { ApplicationStatusBadge } from "@/features/applications/components/application-status-badge";
import { StudentAvatar } from "@/features/students/components/student-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dayKey(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function ApplicationsWorkspace({
  applications,
  classOptions,
}: {
  applications: ApplicationListItem[];
  classOptions: { id: string; gradeName: string }[];
}) {
  const [q, setQ] = useState("");
  const [grade, setGrade] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return applications.filter((app) => {
      if (needle) {
        const hay = `${app.applicantName} ${app.admissionNumber}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (grade && (app.appliedClassName ?? "") !== grade) return false;
      const submitted = dayKey(app.submittedAt);
      if (from && (!submitted || submitted < from)) return false;
      if (to && (!submitted || submitted > to)) return false;
      return true;
    });
  }, [applications, q, grade, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageIndex = Math.min(page, totalPages - 1);
  const slice = filtered.slice(
    pageIndex * PAGE_SIZE,
    pageIndex * PAGE_SIZE + PAGE_SIZE,
  );
  const fromRow = filtered.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const toRow = Math.min(filtered.length, (pageIndex + 1) * PAGE_SIZE);

  function resetLocalFilters() {
    setQ("");
    setGrade("");
    setFrom("");
    setTo("");
    setPage(0);
  }

  const hasLocalFilters = Boolean(q || grade || from || to);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 space-y-4 rounded-xl border bg-card/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <div className="space-y-2">
            <Label htmlFor="app-search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="app-search"
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(0);
                }}
                placeholder="Applicant or admission number"
                className="pl-9"
                aria-label="Search applications"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-from">Submitted from</Label>
            <Input
              id="app-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-to">Submitted to</Label>
            <Input
              id="app-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(0);
              }}
            />
          </div>
          {hasLocalFilters ? (
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                onClick={resetLocalFilters}
              >
                Clear filters
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Grade / class applied for
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Grade filters"
          >
            <button
              type="button"
              className={cn(
                buttonVariants({
                  variant: grade === "" ? "default" : "outline",
                  size: "sm",
                }),
                "min-h-10 rounded-full px-4",
              )}
              aria-pressed={grade === ""}
              onClick={() => {
                setGrade("");
                setPage(0);
              }}
            >
              All grades
            </button>
            {classOptions.map((option) => {
              const active = grade === option.gradeName;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    buttonVariants({
                      variant: active ? "default" : "outline",
                      size: "sm",
                    }),
                    "min-h-10 rounded-full px-4",
                  )}
                  aria-pressed={active}
                  onClick={() => {
                    setGrade(option.gradeName);
                    setPage(0);
                  }}
                >
                  {option.gradeName}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No applications match"
          description="Adjust search, grade, or date filters — or clear them to see the full status queue."
          icon={
            <ClipboardList
              className="size-7 text-muted-foreground"
              aria-hidden
            />
          }
          size="lg"
          action={
            hasLocalFilters ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-10"
                onClick={resetLocalFilters}
              >
                Clear local filters
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {slice.map((application) => {
              const primaryLabel = application.applicantName || "(unnamed)";
              return (
                <article
                  key={application.id}
                  className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <StudentAvatar name={primaryLabel} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/applications/${application.id}`}
                          className="font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {primaryLabel}
                        </Link>
                        <ApplicationStatusBadge status={application.status} />
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {application.admissionNumber}
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Grade</dt>
                      <dd>{application.appliedClassName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Submitted</dt>
                      <dd>{formatDate(application.submittedAt)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Guardian</dt>
                      <dd className="flex items-center gap-1.5 text-muted-foreground">
                        <UserRound className="size-3.5" aria-hidden />
                        See review page
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={`/dashboard/applications/${application.id}`}
                    className={cn(buttonVariants({ size: "sm" }), "w-full")}
                  >
                    Review
                  </Link>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <div className="relative max-h-[min(70vh,40rem)] overflow-auto">
              <Table>
                <TableHeader className={stickyHeaderClass}>
                  <TableRow>
                    <TableHead className="w-12" />
                    <TableHead>Applicant</TableHead>
                    <TableHead>Admission #</TableHead>
                    <TableHead>Applied grade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice.map((application) => {
                    const name = application.applicantName || "(unnamed)";
                    return (
                      <TableRow
                        key={application.id}
                        className="group transition-colors hover:bg-muted/40"
                      >
                        <TableCell>
                          <StudentAvatar name={name} />
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/dashboard/applications/${application.id}`}
                            className="hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            {name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {application.admissionNumber}
                        </TableCell>
                        <TableCell>
                          {application.appliedClassName ?? "—"}
                        </TableCell>
                        <TableCell>
                          <ApplicationStatusBadge status={application.status} />
                        </TableCell>
                        <TableCell>
                          {formatDate(application.submittedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/dashboard/applications/${application.id}`}
                            className={cn(
                              buttonVariants({
                                variant: "ghost",
                                size: "sm",
                              }),
                            )}
                          >
                            Review
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-medium text-foreground">
                {fromRow}–{toRow}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {filtered.length}
              </span>
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
        </>
      )}
    </div>
  );
}
