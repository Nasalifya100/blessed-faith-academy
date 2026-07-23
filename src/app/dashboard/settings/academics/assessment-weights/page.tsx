import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import {
  getDefaultWeightScheme,
  listAssessmentTypes,
} from "@/features/academics/queries";
import { WeightSchemeForm } from "@/features/academics/components/academic-setup-forms";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function AssessmentWeightsPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const [types, scheme] = await Promise.all([
    listAssessmentTypes(),
    getDefaultWeightScheme(),
  ]);

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Assessment weights"
        description="Decide how assignments, tests, and exams combine to 100%."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Default weight template</CardTitle>
          <CardDescription>
            Recommended start: Assignments 10%, Tests 20%, Mid-term 30%,
            End-of-term 40%. Totals must equal 100%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WeightSchemeForm
            assessmentTypes={types.map((t) => ({ id: t.id, name: t.name }))}
            schemeId={scheme?.id}
            initialItems={scheme?.items?.map((i) => ({
              assessment_type_id: i.assessment_type_id,
              weight_percentage: Number(i.weight_percentage),
            }))}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
