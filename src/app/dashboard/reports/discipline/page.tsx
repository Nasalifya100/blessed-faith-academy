import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, FolderOpen, Repeat } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listSchoolDisciplineIncidents } from "@/features/discipline/queries";
import { getDisciplineSnapshotReport } from "@/features/reports/queries";
import { toCsv } from "@/features/reports/csv";
import {
  DownloadCsvButton,
  PrintReportButton,
} from "@/features/reports/components/report-actions";
import { DisciplineReportTable } from "@/features/reports/components/discipline-report-table";
import { ReportFilterBar } from "@/features/reports/components/report-filter-bar";
import {
  BackLink,
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

const REPORT_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function deriveInsights(
  rows: Awaited<ReturnType<typeof listSchoolDisciplineIncidents>>,
) {
  const byStudent = new Map<string, number>();
  const byTitle = new Map<string, number>();

  for (const row of rows) {
    byStudent.set(row.studentId, (byStudent.get(row.studentId) ?? 0) + 1);
    const key = row.title.trim() || "Untitled";
    byTitle.set(key, (byTitle.get(key) ?? 0) + 1);
  }

  const repeatOffenders = [...byStudent.values()].filter((n) => n > 1).length;

  let mostCommon = "—";
  let mostCount = 0;
  for (const [title, count] of byTitle) {
    if (count > mostCount) {
      mostCommon = title;
      mostCount = count;
    }
  }

  return {
    repeatOffenders,
    mostCommon: mostCount > 0 ? mostCommon : "—",
    mostCount,
  };
}

export default async function DisciplineReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !REPORT_ROLES.includes(role)) {
    redirect("/dashboard/reports");
  }

  const params = await searchParams;
  const statusParam = firstValue(params.status) || "all";
  const statusFilter =
    statusParam === "open" ||
    statusParam === "resolved" ||
    statusParam === "all"
      ? statusParam
      : "all";

  const [snapshot, incidents] = await Promise.all([
    getDisciplineSnapshotReport(),
    listSchoolDisciplineIncidents({
      status: statusFilter,
      limit: 200,
    }),
  ]);

  const insights = deriveInsights(incidents);

  const csv = toCsv(
    [
      "Date",
      "Admission number",
      "Student",
      "Incident",
      "Severity",
      "Status",
      "Rule",
    ],
    incidents.map((row) => [
      row.incidentDate,
      row.admissionNumber,
      row.studentName,
      row.title,
      row.severity,
      row.status,
      row.relatedRuleTitle ?? "",
    ]),
  );

  const filters = [
    { value: "all", label: "All" },
    { value: "open", label: "Open" },
    { value: "resolved", label: "Resolved" },
  ] as const;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Reports"
        title="Discipline"
        description="Open vs resolved incidents. Manage day-to-day cases from the Discipline workspace."
        breadcrumb={
          <BackLink href="/dashboard/reports" className="print:hidden">
            Back to reports
          </BackLink>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link
              href="/dashboard/discipline"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Discipline workspace
            </Link>
            <DownloadCsvButton
              filename={`discipline-${statusFilter}.csv`}
              csv={csv}
            />
            <PrintReportButton />
          </div>
        }
      />

      <ReportFilterBar label="Discipline status filter">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
          {filters.map((filter) => (
            <Link
              key={filter.value}
              href={`/dashboard/reports/discipline?status=${filter.value}`}
              className={cn(
                buttonVariants({
                  variant:
                    statusFilter === filter.value ? "default" : "outline",
                  size: "sm",
                }),
                "min-h-10",
              )}
              aria-current={statusFilter === filter.value ? "page" : undefined}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </ReportFilterBar>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Open cases"
          value={String(snapshot.openCount)}
          hint={`${snapshot.highOpenCount} high severity`}
          icon={FolderOpen}
          tone={snapshot.openCount > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Resolved cases"
          value={String(snapshot.resolvedCount)}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          title="Repeat offenders"
          value={String(insights.repeatOffenders)}
          hint="Students with more than one incident in this list"
          icon={Repeat}
          tone={insights.repeatOffenders > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Most common incident"
          value={
            insights.mostCommon === "—"
              ? "—"
              : insights.mostCommon.length > 18
                ? `${insights.mostCommon.slice(0, 18)}…`
                : insights.mostCommon
          }
          hint={
            insights.mostCount > 0
              ? `${insights.mostCount} occurrence${insights.mostCount === 1 ? "" : "s"} in loaded rows`
              : "No incidents in this view"
          }
          icon={AlertTriangle}
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Incident list</CardTitle>
          <CardDescription>
            Showing up to 200 most recent incidents for the selected filter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <EmptyState
              title="No discipline records"
              description={
                statusFilter === "open"
                  ? "There are no open incidents right now."
                  : statusFilter === "resolved"
                    ? "No resolved incidents in the loaded set."
                    : "No discipline incidents have been recorded yet."
              }
              icon={
                <AlertTriangle
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              }
              size="sm"
            />
          ) : (
            <div className="space-y-3">
              <SectionHeading
                title="Cases"
                description="Search by student, admission number, or incident title."
              />
              <DisciplineReportTable rows={incidents} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
