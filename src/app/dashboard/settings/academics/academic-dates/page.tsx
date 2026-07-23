import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import { listWorkflowPeriods } from "@/features/academics/queries";
import { WorkflowDatesForm } from "@/features/academics/components/academic-setup-forms";
import { WORKFLOW_TYPE_LABELS } from "@/features/academics/schemas";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function AcademicDatesPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const period = await listAcademicYearsAndTerms();
  const currentYear =
    period.years.find((y) => y.isCurrent) ?? period.years[0] ?? null;
  const periods = currentYear
    ? await listWorkflowPeriods(currentYear.id)
    : [];

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Academic dates"
        description="Optional windows for marks entry, moderation, approval, and publication."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Set dates</CardTitle>
          <CardDescription>
            Example: Marks entry opens 3 April and closes 10 April. You can skip
            this during initial setup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowDatesForm
            years={period.years.map((y) => ({ id: y.id, name: y.name }))}
            terms={period.terms.map((t) => ({
              id: t.id,
              name: t.name,
              academic_year_id: t.academicYearId,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved dates</CardTitle>
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <EmptyState
              title="No academic dates yet"
              description="Add marks-entry or publication dates when you are ready."
              size="sm"
            />
          ) : (
            <ul className="space-y-2">
              {periods.map((row) => (
                <li key={row.id} className="rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">
                    {WORKFLOW_TYPE_LABELS[row.workflow_type] ??
                      row.workflow_type}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · Opens {row.starts_at}
                    {row.ends_at ? ` · Closes ${row.ends_at}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
