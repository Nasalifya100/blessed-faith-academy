import Link from "next/link";

import type { GradebookHubContext } from "@/features/gradebook/queries";
import { GradebookStatusBadge } from "@/features/gradebook/components/gradebook-status-badge";
import { OpenGradebookButton } from "@/features/gradebook/components/open-gradebook-button";
import {
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZM", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function HubFilters({
  hub,
  filters,
}: {
  hub: GradebookHubContext;
  filters: {
    year?: string;
    term?: string;
    classId?: string;
    subjectId?: string;
    status?: string;
  };
}) {
  return (
    <form
      method="get"
      className="grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <label className="space-y-1 text-sm">
        <span className="font-medium">Academic year</span>
        <select
          name="year"
          defaultValue={filters.year ?? hub.activeYearId ?? ""}
          className="flex h-11 w-full rounded-xl border bg-background px-3"
        >
          {hub.academicYears.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
              {y.is_current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="font-medium">Term</span>
        <select
          name="term"
          defaultValue={filters.term ?? hub.activeTermId ?? "all"}
          className="flex h-11 w-full rounded-xl border bg-background px-3"
        >
          <option value="all">All terms</option>
          {hub.terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.is_current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="font-medium">Class</span>
        <select
          name="class"
          defaultValue={filters.classId ?? "all"}
          className="flex h-11 w-full rounded-xl border bg-background px-3"
        >
          <option value="all">All classes</option>
          {hub.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade_name} · {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="font-medium">Subject</span>
        <select
          name="subject"
          defaultValue={filters.subjectId ?? "all"}
          className="flex h-11 w-full rounded-xl border bg-background px-3"
        >
          <option value="all">All subjects</option>
          {hub.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="font-medium">Status</span>
        <select
          name="status"
          defaultValue={filters.status ?? "all"}
          className="flex h-11 w-full rounded-xl border bg-background px-3"
        >
          <option value="all">All</option>
          <option value="READY">Ready to start</option>
          <option value="DRAFT">Draft</option>
          <option value="REOPENED">Reopened</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="LOCKED">Locked</option>
        </select>
      </label>
      <div className="sm:col-span-2 lg:col-span-5">
        <button
          type="submit"
          className={cn(buttonVariants({ size: "sm" }), "min-h-11")}
        >
          Apply filters
        </button>
      </div>
    </form>
  );
}

function ItemCards({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: GradebookHubContext["items"];
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionHeading title={title} description={description} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key}>
            <Card className="h-full shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">
                    {item.subject_name}
                  </CardTitle>
                  <GradebookStatusBadge status={item.status} />
                </div>
                <CardDescription>
                  {item.grade_name} · {item.class_name} · {item.exam_reference}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {item.academic_year_name}
                  {item.term_name ? ` · ${item.term_name}` : ""} · Max{" "}
                  {item.max_marks}
                </p>
                <p className="text-xs text-muted-foreground">
                  Updated {formatWhen(item.last_updated_at)}
                </p>
                {!item.assigned_to_viewer ? (
                  <p className="text-xs font-medium text-amber-800">
                    Viewing outside your teaching assignments
                  </p>
                ) : null}
                <OpenGradebookButton
                  examId={item.exam_id}
                  classId={item.class_id}
                  gradebookId={item.gradebook_id}
                  label={
                    item.status === "READY"
                      ? "Open gradebook"
                      : item.status === "DRAFT" || item.status === "REOPENED"
                        ? "Continue"
                        : "View"
                  }
                  variant={
                    item.status === "SUBMITTED" || item.status === "LOCKED"
                      ? "outline"
                      : "default"
                  }
                />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GradebookHubView({
  hub,
  filters,
}: {
  hub: GradebookHubContext;
  filters: {
    year?: string;
    term?: string;
    classId?: string;
    subjectId?: string;
    status?: string;
  };
}) {
  const needsAttention = hub.items.filter((i) => i.status === "REOPENED");
  const drafts = hub.items.filter((i) => i.status === "DRAFT");
  const ready = hub.items.filter((i) => i.status === "READY");
  const submitted = hub.items.filter((i) => i.status === "SUBMITTED");
  const locked = hub.items.filter((i) => i.status === "LOCKED");

  return (
    <PageShell>
      <PageHeader
        title="Gradebook"
        description="Enter and submit exam marks for your assigned classes. Marks stay private until you submit."
        actions={
          <Link
            href="/dashboard/examinations"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Examinations
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Needs attention"
          value={String(needsAttention.length)}
          hint="Reopened for correction"
        />
        <StatCard
          title="In progress"
          value={String(drafts.length + ready.length)}
          hint="Drafts and ready to start"
        />
        <StatCard
          title="Submitted"
          value={String(submitted.length)}
          hint="Awaiting lock"
        />
        <StatCard
          title="Locked"
          value={String(locked.length)}
          hint="Finalised"
        />
      </div>

      {hub.viewAll ? (
        <p
          className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
          role="status"
        >
          You can monitor gradebooks across the school. Items outside your own
          teaching assignments are labelled.
        </p>
      ) : null}

      <HubFilters hub={hub} filters={filters} />

      {hub.items.length === 0 ? (
        <EmptyState
          title="No gradebooks to show"
          description="There are no completed exams matching your assignments and filters. Marks entry only appears for completed exams while any marks-entry window is open."
        />
      ) : (
        <div className="space-y-8">
          <ItemCards
            title="Needs attention"
            description="Reopened gradebooks that need edits and resubmission."
            items={needsAttention}
          />
          <ItemCards
            title="Draft or in progress"
            description="Saved drafts waiting for completion."
            items={drafts}
          />
          <ItemCards
            title="Ready to start"
            description="Completed exams you can open for marks entry."
            items={ready}
          />
          <ItemCards
            title="Submitted"
            description="Read-only until an authorised reopen."
            items={submitted}
          />
          <ItemCards
            title="Locked"
            description="Finalised gradebooks."
            items={locked}
          />
        </div>
      )}
    </PageShell>
  );
}
