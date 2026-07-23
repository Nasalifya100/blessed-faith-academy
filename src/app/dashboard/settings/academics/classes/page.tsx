import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import { listClassesForYear, listGradeLevels } from "@/features/academics/queries";
import { CreateClassForm } from "@/features/academics/components/academic-setup-forms";
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

export default async function AcademicClassesPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const period = await listAcademicYearsAndTerms();
  const grades = await listGradeLevels();
  const currentYear =
    period.years.find((y) => y.isCurrent) ?? period.years[0] ?? null;
  const classes = currentYear
    ? await listClassesForYear(currentYear.id)
    : [];

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Academic setup"
        title="Classes and streams"
        description="Add parallel streams such as Grade 7A and Grade 7B when needed."
        breadcrumb={
          <BackLink href="/dashboard/settings/academics">
            Back to academic setup
          </BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Add class</CardTitle>
          <CardDescription>
            A single class can stay named simply “Grade 5” — you do not need a
            stream letter unless the grade has more than one class.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateClassForm
            years={period.years.map((y) => ({ id: y.id, name: y.name }))}
            grades={grades.map((g) => ({ id: g.id, name: g.name }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {currentYear ? `Classes in ${currentYear.name}` : "Classes"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <EmptyState
              title="No classes yet"
              description="Add the first class for the current academic year."
              size="sm"
            />
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3">Class</th>
                      <th className="py-2 pr-3">Grade</th>
                      <th className="py-2 pr-3">Stream</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((cls) => {
                      const grade = cls.grade_levels as
                        | { name?: string }
                        | { name?: string }[]
                        | null;
                      const gradeName = Array.isArray(grade)
                        ? grade[0]?.name
                        : grade?.name;
                      return (
                        <tr key={cls.id} className="border-b">
                          <td className="py-2 pr-3 font-medium">{cls.name}</td>
                          <td className="py-2 pr-3">{gradeName ?? "—"}</td>
                          <td className="py-2 pr-3">{cls.stream_code ?? "—"}</td>
                          <td className="py-2">
                            {cls.is_active ? "Active" : "Inactive"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3 md:hidden">
                {classes.map((cls) => {
                  const grade = cls.grade_levels as
                    | { name?: string }
                    | { name?: string }[]
                    | null;
                  const gradeName = Array.isArray(grade)
                    ? grade[0]?.name
                    : grade?.name;
                  return (
                    <li key={cls.id} className="rounded-md border p-3">
                      <p className="font-medium">{cls.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {gradeName ?? "Grade"}
                        {cls.stream_code ? ` · Stream ${cls.stream_code}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
