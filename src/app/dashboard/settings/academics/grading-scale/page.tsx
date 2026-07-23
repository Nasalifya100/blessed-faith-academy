import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { getDefaultGradingScheme } from "@/features/academics/queries";
import { GradingScaleForm } from "@/features/academics/components/academic-setup-forms";
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

export default async function GradingScalePage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const scheme = await getDefaultGradingScheme();

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Grading scale"
        description="Confirm how scores map to Distinction, Merit, Credit, Pass, and Fail."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>School grading scale</CardTitle>
          <CardDescription>
            Recommended defaults are editable. Confirm the scale before marks
            entry in a later phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GradingScaleForm
            schemeId={scheme?.id}
            initialName={scheme?.name}
            initialBands={scheme?.bands?.map((b) => ({
              minimum_score: Number(b.minimum_score),
              maximum_score: Number(b.maximum_score),
              grade_code: b.grade_code,
              grade_label: b.grade_label,
              is_pass: b.is_pass,
            }))}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
