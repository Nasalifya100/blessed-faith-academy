import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listStaffWithEmails } from "@/features/staff/queries";
import { CreateStaffForm } from "@/features/staff/components/create-staff-form";
import { StaffTable } from "@/features/staff/components/staff-table";
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Staff accounts</h1>
        <p className="text-muted-foreground">
          Create staff logins and manage their roles and access.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a staff member</CardTitle>
          <CardDescription>
            They can sign in immediately using the email and temporary password
            you set here. Ask them to keep the password private.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateStaffForm />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">All staff</h2>
        <StaffTable staff={staff} currentUserId={current.id} />
      </div>
    </div>
  );
}
