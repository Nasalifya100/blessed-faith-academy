"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Search } from "lucide-react";

import { updateSchoolRuleAction } from "@/features/discipline/actions";
import type { SchoolRuleRow } from "@/features/discipline/queries";
import { SectionHeading } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { stickyHeaderClass, filterPanelClassName } from "@/components/ui/admin-chrome";
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

interface SchoolRulesEditorProps {
  rules: SchoolRuleRow[];
  canEdit: boolean;
}

export function SchoolRulesList({ rules, canEdit }: SchoolRulesEditorProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeCount = rules.filter((r) => r.isActive).length;
  const inactiveCount = rules.filter((r) => !r.isActive).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (statusFilter === "active" && !rule.isActive) return false;
      if (statusFilter === "inactive" && rule.isActive) return false;
      if (!q) return true;
      return (
        rule.title.toLowerCase().includes(q) ||
        rule.body.toLowerCase().includes(q) ||
        String(rule.sortOrder).includes(q)
      );
    });
  }, [rules, search, statusFilter]);

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No rules configured"
        description={
          <>
            No school rules found. Run migration{" "}
            <code className="text-xs">
              20260715250100_seed_school_rules_if_empty.sql
            </code>{" "}
            in Supabase, then refresh.
          </>
        }
        icon={<BookOpen className="size-6 text-muted-foreground" aria-hidden />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total active rules"
          value={String(activeCount)}
          hint="Shown on incident forms"
          icon={BookOpen}
          tone="success"
        />
        <StatCard
          title="Inactive rules"
          value={String(inactiveCount)}
          hint="Hidden from new incidents"
          tone={inactiveCount > 0 ? "warning" : "success"}
        />
        <StatCard
          title="High-severity rules"
          value="—"
          hint="Rule severity is not stored on school rules"
        />
        <StatCard
          title="Rules in incidents"
          value="—"
          hint="Open Discipline to see rules linked on cases"
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Rules library</CardTitle>
          <CardDescription>
            Rule number uses the sort order. Severity, suggested action, and
            grade applicability are not stored on rules yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="search"
            aria-label="Rule filters"
            className={filterPanelClassName("lg:grid-cols-2")}
          >
            <div className="relative space-y-1.5">
              <Label htmlFor="rule-search">Search</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="rule-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title or description…"
                  className="h-11 pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-status">Status</Label>
              <SelectNative
                id="rule-status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as "all" | "active" | "inactive",
                  )
                }
                className="h-11"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectNative>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No results for current filters"
              description="Try a different search or status filter."
              size="sm"
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden max-h-[min(70vh,40rem)] overflow-auto rounded-xl border shadow-sm md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      {canEdit ? <TableHead className="w-28" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {rule.sortOrder}
                        </TableCell>
                        <TableCell className="align-top font-medium">
                          {rule.title}
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground whitespace-normal">
                          <p className="line-clamp-3">{rule.body}</p>
                        </TableCell>
                        <TableCell className="align-top">
                          {rule.isActive ? (
                            <StatusBadge tone="success">Active</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Inactive</StatusBadge>
                          )}
                        </TableCell>
                        {canEdit ? (
                          <TableCell className="align-top text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-10"
                              onClick={() =>
                                setEditingId(
                                  editingId === rule.id ? null : rule.id,
                                )
                              }
                            >
                              {editingId === rule.id ? "Close" : "Edit"}
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <ul className="space-y-3 md:hidden">
                {filtered.map((rule) => (
                  <li
                    key={rule.id}
                    className="space-y-2 rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Rule #{rule.sortOrder}
                        </p>
                        <p className="font-medium">{rule.title}</p>
                      </div>
                      {rule.isActive ? (
                        <StatusBadge tone="success">Active</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Inactive</StatusBadge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {rule.body}
                    </p>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10 w-full"
                        onClick={() =>
                          setEditingId(editingId === rule.id ? null : rule.id)
                        }
                      >
                        {editingId === rule.id ? "Close editor" : "Edit rule"}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {canEdit && editingId
        ? (() => {
            const rule = rules.find((r) => r.id === editingId);
            if (!rule) return null;
            return (
              <Card className="shadow-sm" id="rule-editor">
                <CardHeader>
                  <CardTitle>Edit rule</CardTitle>
                  <CardDescription>
                    Inactive rules stay hidden from incident forms. Historical
                    links on past incidents are preserved.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SchoolRuleEditor
                    key={rule.id}
                    rule={rule}
                    onSaved={() => setEditingId(null)}
                  />
                </CardContent>
              </Card>
            );
          })()
        : null}

      {!canEdit ? (
        <section className="space-y-3">
          <SectionHeading
            title="Reference view"
            description="Contact the headteacher or administrator to change rules."
          />
        </section>
      ) : null}
    </div>
  );
}

function SchoolRuleEditor({
  rule,
  onSaved,
}: {
  rule: SchoolRuleRow;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(rule.title);
  const [body, setBody] = useState(rule.body);
  const [sortOrder, setSortOrder] = useState(rule.sortOrder);
  const [isActive, setIsActive] = useState(rule.isActive);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updateSchoolRuleAction({
        ruleId: rule.id,
        title,
        body,
        sortOrder,
        isActive,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Saved.");
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-2">
          <Label htmlFor={`title-${rule.id}`}>
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`title-${rule.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`order-${rule.id}`}>Rule #</Label>
          <Input
            id={`order-${rule.id}`}
            type="number"
            min={0}
            value={sortOrder}
            onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
            className="h-11 w-24"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`body-${rule.id}`}>
          Description <span className="text-destructive">*</span>
        </Label>
        <textarea
          id={`body-${rule.id}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className="min-h-11"
          disabled={isPending}
          onClick={onSave}
        >
          {isPending ? "Saving…" : "Save rule"}
        </Button>
        {message ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Uncheck Active and save to hide this rule from incident forms. Past
        incidents keep their linked rule title.
      </p>
    </div>
  );
}
