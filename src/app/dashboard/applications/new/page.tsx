import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canManageApplications } from "@/features/auth/permissions";
import { getEnrolmentFormData } from "@/features/students/queries";
import { ApplicationForm } from "@/features/applications/components/application-form";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

export default async function NewApplicationPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!canManageApplications(role)) {
    redirect("/dashboard");
  }

  const { classes, suggestedAdmissionNumber } = await getEnrolmentFormData();

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Admissions"
        title="New application"
        description="Register a new applicant. They become an enrolled student once the application is approved."
        breadcrumb={
          <BackLink href="/dashboard/applications">
            Back to applications
          </BackLink>
        }
      />

      <ApplicationForm
        classes={classes}
        suggestedAdmissionNumber={suggestedAdmissionNumber}
      />
    </PageShell>
  );
}
