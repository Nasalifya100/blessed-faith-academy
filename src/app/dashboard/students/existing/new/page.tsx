import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canMigrateExistingStudents } from "@/features/auth/permissions";
import { getEnrolmentFormData } from "@/features/students/queries";
import { getFeesSetupData } from "@/features/fees/queries";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import { AddExistingStudentForm } from "@/features/students/components/add-existing-student-form";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

export default async function AddExistingStudentPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!canMigrateExistingStudents(role)) {
    redirect("/dashboard/students");
  }

  const [enrolment, fees, periods] = await Promise.all([
    getEnrolmentFormData(),
    getFeesSetupData(),
    listAcademicYearsAndTerms(),
  ]);

  const feeItems = fees.items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
  }));

  const currentYearId =
    periods.years.find((year) => year.isCurrent)?.id ??
    periods.years[0]?.id ??
    "";

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Students"
        title="Add Existing Student"
        description="For learners who joined Blessed Faith Academy before the digital system was introduced."
        breadcrumb={
          <BackLink href="/dashboard/students">Back to students</BackLink>
        }
      />

      {enrolment.classes.length === 0 || !currentYearId ? (
        <p className="text-sm text-muted-foreground">
          Configure the current academic year and at least one class before
          adding existing students.{" "}
          <Link href="/dashboard/settings" className="underline">
            Open settings
          </Link>
        </p>
      ) : (
        <AddExistingStudentForm
          classes={enrolment.classes}
          suggestedAdmissionNumber={enrolment.suggestedAdmissionNumber}
          academicYearName={enrolment.academicYearName}
          feeItems={feeItems}
          years={periods.years}
          terms={periods.terms}
          currentYearId={currentYearId}
        />
      )}
    </PageShell>
  );
}
