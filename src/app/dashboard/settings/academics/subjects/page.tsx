import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { listSubjects } from "@/features/academics/queries";
import {
  SubjectActiveToggle,
  SubjectForm,
} from "@/features/academics/components/academic-setup-forms";
import { SUBJECT_CATEGORY_LABELS } from "@/features/academics/schemas";
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

export default async function SubjectsPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const subjects = await listSubjects();

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Subjects"
        description="Add the subjects taught at the school. Keep the form simple — only the name is required."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Add subject</CardTitle>
          <CardDescription>
            Examples: Mathematics, English, Integrated Science, Social Studies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubjectForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subject catalogue</CardTitle>
        </CardHeader>
        <CardContent>
          {subjects.length === 0 ? (
            <EmptyState
              title="No subjects yet"
              description="Add Mathematics or English to get started."
              size="sm"
            />
          ) : (
            <ul className="space-y-3">
              {subjects.map((subject) => (
                <li
                  key={subject.id}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{subject.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {SUBJECT_CATEGORY_LABELS[
                        subject.subject_category as keyof typeof SUBJECT_CATEGORY_LABELS
                      ] ?? subject.subject_category}
                      {subject.code ? ` · ${subject.code}` : ""}
                      {subject.is_active ? "" : " · Inactive"}
                    </p>
                  </div>
                  <SubjectActiveToggle
                    subjectId={subject.id}
                    isActive={subject.is_active}
                    name={subject.name}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
