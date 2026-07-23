import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenAcademicSetup } from "@/features/academics/permissions";
import { getAcademicSetupChecklist } from "@/features/academics/queries";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    key: "year",
    label: "Academic year selected",
    href: "/dashboard/settings#academic-period",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.hasCurrentYear,
  },
  {
    key: "terms",
    label: "Terms configured",
    href: "/dashboard/settings#academic-period",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.hasTerms,
  },
  {
    key: "classes",
    label: "Classes configured",
    href: "/dashboard/settings/academics/classes",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.hasClasses,
  },
  {
    key: "subjects",
    label: "Subjects added",
    href: "/dashboard/settings/academics/subjects",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.hasSubjects,
  },
  {
    key: "offerings",
    label: "Subjects assigned to grades",
    href: "/dashboard/settings/academics/subjects-by-grade",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.hasOfferings,
  },
  {
    key: "teachers",
    label: "Teachers assigned",
    href: "/dashboard/settings/academics/teacher-assignments",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.hasTeachingAssignments,
  },
  {
    key: "grading",
    label: "Grading scale confirmed",
    href: "/dashboard/settings/academics/grading-scale",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.gradingConfirmed,
  },
  {
    key: "weights",
    label: "Assessment weights confirmed",
    href: "/dashboard/settings/academics/assessment-weights",
    done: (c: Awaited<ReturnType<typeof getAcademicSetupChecklist>>) =>
      c.weightsConfirmed,
  },
] as const;

const LINKS = [
  {
    href: "/dashboard/settings/academics/classes",
    title: "Classes and streams",
    description: "Add Grade 7A / 7B style classes when needed.",
  },
  {
    href: "/dashboard/settings/academics/subjects",
    title: "Subjects",
    description: "Build the school subject catalogue.",
  },
  {
    href: "/dashboard/settings/academics/subjects-by-grade",
    title: "Subjects by grade",
    description: "Tick which subjects each grade studies.",
  },
  {
    href: "/dashboard/settings/academics/teacher-assignments",
    title: "Teacher assignments",
    description: "Link teachers to subjects and grades.",
  },
  {
    href: "/dashboard/settings/academics/grading-scale",
    title: "Grading scale",
    description: "Confirm Distinction / Merit / Pass bands.",
  },
  {
    href: "/dashboard/settings/academics/assessment-types",
    title: "Assessment types",
    description: "Assignments, tests, exams, and more.",
  },
  {
    href: "/dashboard/settings/academics/assessment-weights",
    title: "Assessment weights",
    description: "How continuous work and exams combine.",
  },
  {
    href: "/dashboard/settings/academics/academic-dates",
    title: "Academic dates",
    description: "Optional marks-entry and publication windows.",
  },
] as const;

export default async function AcademicSetupPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenAcademicSetup(current.profile.role)) {
    redirect("/dashboard");
  }

  const checklist = await getAcademicSetupChecklist();

  return (
    <PageShell className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Academic setup"
        description="Prepare subjects, teachers, and grading before marks entry begins."
        breadcrumb={
          <BackLink href="/dashboard/settings">Back to settings</BackLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Setup checklist</CardTitle>
          <CardDescription>
            Complete these steps in order. Advanced options stay optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {STEPS.map((step) => {
              const done = step.done(checklist);
              return (
                <li key={step.key}>
                  <Link
                    href={step.href}
                    className="flex items-start gap-3 rounded-md border px-3 py-3 hover:bg-muted/40"
                  >
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{step.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {LINKS.map((link) => (
          <Card key={link.href}>
            <CardHeader>
              <CardTitle className="text-base">{link.title}</CardTitle>
              <CardDescription>{link.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={link.href}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Open
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
