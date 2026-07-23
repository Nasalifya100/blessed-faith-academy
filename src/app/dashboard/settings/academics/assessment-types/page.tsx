import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { listAssessmentTypes } from "@/features/academics/queries";
import { seedAssessmentTypesAction } from "@/features/academics/actions";
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
import { Button } from "@/components/ui/button";

export default async function AssessmentTypesPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const types = await listAssessmentTypes();

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Assessment types"
        description="Assignments, tests, projects, and examinations used later in the gradebook."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Common types</CardTitle>
          <CardDescription>
            Start from sensible defaults. You can deactivate unused types later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={seedAssessmentTypesAction}>
            <Button type="submit">Add common assessment types</Button>
          </form>
          {types.length === 0 ? (
            <EmptyState
              title="No assessment types yet"
              description="Add the common set to continue with assessment weights."
              size="sm"
            />
          ) : (
            <ul className="space-y-2">
              {types.map((type) => (
                <li
                  key={type.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{type.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · default max {type.default_maximum_mark}
                    {type.is_exam ? " · exam" : ""}
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
