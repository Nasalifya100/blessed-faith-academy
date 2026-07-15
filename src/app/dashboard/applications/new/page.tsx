import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getEnrolmentFormData } from "@/features/students/queries";
import { ApplicationForm } from "@/features/applications/components/application-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

export default async function NewApplicationPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !MANAGER_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const { classes, suggestedAdmissionNumber } = await getEnrolmentFormData();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/dashboard/applications"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to applications
        </Link>
        <h1 className="text-2xl font-bold">New application</h1>
        <p className="text-muted-foreground">
          Register a new applicant. They become an enrolled student once the
          application is approved.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application form</CardTitle>
          <CardDescription>
            Capture the child&apos;s details, guardian(s), and the
            parent&apos;s declaration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApplicationForm
            classes={classes}
            suggestedAdmissionNumber={suggestedAdmissionNumber}
          />
        </CardContent>
      </Card>
    </div>
  );
}
