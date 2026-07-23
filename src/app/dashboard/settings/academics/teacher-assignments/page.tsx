import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import { listStaffWithEmails } from "@/features/staff/queries";
import {
  listActiveOfferings,
  listTeachingAssignments,
} from "@/features/academics/queries";
import {
  AssignTeacherForm,
  EndAssignmentButton,
} from "@/features/academics/components/academic-setup-forms";
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

export default async function TeacherAssignmentsPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const period = await listAcademicYearsAndTerms();
  const currentYear =
    period.years.find((y) => y.isCurrent) ?? period.years[0] ?? null;
  const [offerings, assignments, staff] = await Promise.all([
    listActiveOfferings(currentYear?.id),
    listTeachingAssignments(currentYear?.id),
    listStaffWithEmails(),
  ]);

  const teachers = staff
    .filter((s) => s.is_active && (s.role === "teacher" || s.role === "headteacher"))
    .map((s) => ({ id: s.id, name: s.full_name }));

  const offeringOptions = offerings.map((o) => {
    const subject = o.subjects as { name?: string } | { name?: string }[] | null;
    const grade = o.grade_levels as { name?: string } | { name?: string }[] | null;
    const subjectName = Array.isArray(subject) ? subject[0]?.name : subject?.name;
    const gradeName = Array.isArray(grade) ? grade[0]?.name : grade?.name;
    return {
      id: o.id,
      label: `${gradeName ?? "Grade"} · ${subjectName ?? "Subject"}`,
    };
  });

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Teacher assignments"
        description="Select a subject and teacher, then save. Role defaults to subject teacher."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Assign teacher</CardTitle>
          <CardDescription>
            Assign subjects to grades first if the subject list is empty.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignTeacherForm offerings={offeringOptions} teachers={teachers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <EmptyState
              title="No teacher assignments yet"
              description="Assign a teacher to a grade subject to continue setup."
              size="sm"
            />
          ) : (
            <ul className="space-y-3">
              {assignments.map((row) => {
                const profile = row.profiles as
                  | { full_name?: string }
                  | { full_name?: string }[]
                  | null;
                const offering = row.subject_offerings as
                  | {
                      subjects?: { name?: string } | { name?: string }[];
                      grade_levels?: { name?: string } | { name?: string }[];
                    }
                  | null;
                const teacherName = Array.isArray(profile)
                  ? profile[0]?.full_name
                  : profile?.full_name;
                const subject = offering?.subjects;
                const grade = offering?.grade_levels;
                const subjectName = Array.isArray(subject)
                  ? subject[0]?.name
                  : subject?.name;
                const gradeName = Array.isArray(grade)
                  ? grade[0]?.name
                  : grade?.name;
                const label = `${teacherName ?? "Teacher"} · ${gradeName ?? ""} ${subjectName ?? ""}`;
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{teacherName ?? "Teacher"}</p>
                      <p className="text-sm text-muted-foreground">
                        {gradeName ?? "Grade"} · {subjectName ?? "Subject"}
                      </p>
                    </div>
                    <EndAssignmentButton assignmentId={row.id} label={label} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
