import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listStaffWithEmails } from "@/features/staff/queries";
import { CreateStaffForm } from "@/features/staff/components/create-staff-form";
import { StaffTable } from "@/features/staff/components/staff-table";
import {
  BackLink,
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function StaffPage() {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "administrator") {
    redirect("/dashboard");
  }

  const staff = await listStaffWithEmails();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Staff"
        description="Create staff logins and manage roles and system access."
        breadcrumb={
          <BackLink href="/dashboard">Back to dashboard</BackLink>
        }
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Add a staff member</CardTitle>
          <CardDescription>
            New accounts can sign in immediately with the temporary password you
            set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateStaffForm />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <SectionHeading
          title="Staff management"
          description="Overview, directory, and profile details for every account."
        />
        <StaffTable staff={staff} currentUserId={current.id} />
      </section>
    </PageShell>
  );
}
