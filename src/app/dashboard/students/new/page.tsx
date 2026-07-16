import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canManageStudents } from "@/features/auth/permissions";
import { getEnrolmentFormData } from "@/features/students/queries";
import { AddStudentForm } from "@/features/students/components/add-student-form";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

export default async function NewStudentPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!canManageStudents(role)) {
    redirect("/dashboard");
  }

  const { classes, suggestedAdmissionNumber, academicYearName } =
    await getEnrolmentFormData();

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Students"
        title="Add student"
        description={
          <>
            Enrol an existing child into
            {academicYearName
              ? ` the ${academicYearName} academic year`
              : " the current academic year"}
            .
          </>
        }
        breadcrumb={
          <BackLink href="/dashboard/students">Back to students</BackLink>
        }
      />

      <AddStudentForm
        classes={classes}
        suggestedAdmissionNumber={suggestedAdmissionNumber}
      />
    </PageShell>
  );
}
