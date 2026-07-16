"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import {
  setCurrentAcademicYearAction,
  setCurrentTermAction,
} from "@/features/config/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionHeading } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
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

export interface YearOption {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface TermOption {
  id: string;
  name: string;
  academicYearId: string;
  isCurrent: boolean;
}

interface SetCurrentPeriodPanelProps {
  years: YearOption[];
  terms: TermOption[];
  /** When true, also show year/term directory tables (Settings). */
  showDirectory?: boolean;
}

export function SetCurrentPeriodPanel({
  years,
  terms,
  showDirectory = false,
}: SetCurrentPeriodPanelProps) {
  const router = useRouter();
  const [yearId, setYearId] = useState(
    years.find((y) => y.isCurrent)?.id ?? years[0]?.id ?? "",
  );
  const [termId, setTermId] = useState(
    terms.find((t) => t.isCurrent)?.id ?? terms[0]?.id ?? "",
  );
  const [yearSearch, setYearSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"year" | "term" | null>(null);

  const termsForYear = terms.filter((t) => t.academicYearId === yearId);
  const yearNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const year of years) map.set(year.id, year.name);
    return map;
  }, [years]);

  const filteredYears = useMemo(() => {
    const q = yearSearch.trim().toLowerCase();
    if (!q) return years;
    return years.filter((year) => year.name.toLowerCase().includes(q));
  }, [yearSearch, years]);

  const selectedYearName =
    years.find((y) => y.id === yearId)?.name ?? "this year";
  const selectedTermName =
    terms.find((t) => t.id === termId)?.name ?? "this term";

  function runYear() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await setCurrentAcademicYearAction({ id: yearId });
      setConfirm(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Current academic year updated.");
      router.refresh();
    });
  }

  function runTerm() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await setCurrentTermAction({ id: termId });
      setConfirm(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Current term updated.");
      router.refresh();
    });
  }

  if (years.length === 0) {
    return (
      <EmptyState
        title="No academic years"
        description="No academic years are configured yet. Seed or create years in the database first."
        size="sm"
      />
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeading
          title="Set current period"
          description="Only one current year and one current term are allowed. Set the year first, then the term."
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="current-year">Academic year</Label>
            <SelectNative
              id="current-year"
              value={yearId}
              className="h-11"
              onChange={(event) => {
                setYearId(event.target.value);
                const nextTerms = terms.filter(
                  (t) => t.academicYearId === event.target.value,
                );
                setTermId(
                  nextTerms.find((t) => t.isCurrent)?.id ??
                    nextTerms[0]?.id ??
                    "",
                );
              }}
              disabled={isPending}
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                  {year.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </SelectNative>
          </div>
          <Button
            type="button"
            className="min-h-11"
            disabled={isPending || !yearId}
            onClick={() => setConfirm("year")}
          >
            Set current year
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="current-term">Term</Label>
            <SelectNative
              id="current-term"
              value={termId}
              className="h-11"
              onChange={(event) => setTermId(event.target.value)}
              disabled={isPending || termsForYear.length === 0}
            >
              {termsForYear.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                  {term.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </SelectNative>
          </div>
          <Button
            type="button"
            className="min-h-11"
            disabled={isPending || !termId}
            onClick={() => setConfirm("term")}
          >
            Set current term
          </Button>
        </div>

        {message ? (
          <p
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
            role="status"
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {showDirectory ? (
        <>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Academic years</CardTitle>
          <CardDescription>
            Status is Current or Not current from loaded configuration (future /
            archived labels need date fields not loaded here).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={yearSearch}
              onChange={(event) => setYearSearch(event.target.value)}
              placeholder="Search years…"
              aria-label="Search academic years"
              className="h-11 pl-9"
            />
          </div>

          {filteredYears.length === 0 ? (
            <EmptyState
              title="No search results"
              description="Try a different year name."
              size="sm"
            />
          ) : (
            <>
              <div className="hidden max-h-72 overflow-auto rounded-xl border md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead>Academic year</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredYears.map((year) => (
                      <TableRow key={year.id}>
                        <TableCell className="font-medium">{year.name}</TableCell>
                        <TableCell>
                          {year.isCurrent ? (
                            <StatusBadge tone="success">Current</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Not current</StatusBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="space-y-2 md:hidden">
                {filteredYears.map((year) => (
                  <li
                    key={year.id}
                    className="flex items-center justify-between gap-2 rounded-xl border p-3"
                  >
                    <span className="font-medium">{year.name}</span>
                    {year.isCurrent ? (
                      <StatusBadge tone="success">Current</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Not current</StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Terms</CardTitle>
          <CardDescription>
            Start and end dates are not included in the loaded term list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {terms.length === 0 ? (
            <EmptyState
              title="No terms"
              description="No terms are configured for any academic year yet."
              size="sm"
            />
          ) : (
            <>
              <div className="hidden max-h-80 overflow-auto rounded-xl border md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead>Term</TableHead>
                      <TableHead>Academic year</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {terms.map((term) => (
                      <TableRow key={term.id}>
                        <TableCell className="font-medium">{term.name}</TableCell>
                        <TableCell>
                          {yearNameById.get(term.academicYearId) ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell>
                          {term.isCurrent ? (
                            <StatusBadge tone="success">Current</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Not current</StatusBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="space-y-2 md:hidden">
                {terms.map((term) => (
                  <li
                    key={term.id}
                    className="space-y-2 rounded-xl border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{term.name}</p>
                      {term.isCurrent ? (
                        <StatusBadge tone="success">Current</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Not current</StatusBadge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {yearNameById.get(term.academicYearId) ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Dates: not loaded
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
        </>
      ) : null}

      <ConfirmDialog
        open={confirm === "year"}
        title={`Set ${selectedYearName} as current year?`}
        description="This changes the active academic year for the whole school. Enrolment, attendance, and fee catalogues will use this year. Only one year can be current."
        confirmLabel="Set current year"
        pending={isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={runYear}
      />
      <ConfirmDialog
        open={confirm === "term"}
        title={`Set ${selectedTermName} as current term?`}
        description="This changes the active term used for fee generation and term-based reports. Only one term can be current."
        confirmLabel="Set current term"
        pending={isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={runTerm}
      />
    </div>
  );
}
