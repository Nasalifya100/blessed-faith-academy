import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import {
  listGradeLevels,
  listOfferingsForGrade,
  listSubjects,
} from "@/features/academics/queries";
import { GradeSubjectsForm } from "@/features/academics/components/academic-setup-forms";
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

export default async function SubjectsByGradePage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const [period, grades, subjects] = await Promise.all([
    listAcademicYearsAndTerms(),
    listGradeLevels(),
    listSubjects({ activeOnly: true }),
  ]);
  const currentYear =
    period.years.find((y) => y.isCurrent) ?? period.years[0] ?? null;
  const firstGrade = grades[0] ?? null;
  const offerings =
    currentYear && firstGrade
      ? await listOfferingsForGrade({
          academicYearId: currentYear.id,
          gradeLevelId: firstGrade.id,
        })
      : [];

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Subjects by grade"
        description="Choose the subjects taught in each grade. You can assign teachers afterward."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Assign subjects</CardTitle>
          <CardDescription>
            Tick subjects for a grade, then save. Class-specific overrides can
            wait for advanced setup later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GradeSubjectsForm
            years={period.years.map((y) => ({ id: y.id, name: y.name }))}
            grades={grades.map((g) => ({ id: g.id, name: g.name }))}
            subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
            initialSelected={offerings.map((o) => ({
              subject_id: o.subject_id,
              is_compulsory: o.is_compulsory,
            }))}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
