import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getEnrolmentFormData } from "@/features/students/queries";
import { AddStudentForm } from "@/features/students/components/add-student-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

export default async function NewStudentPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!role || !MANAGER_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const { classes, suggestedAdmissionNumber, academicYearName } =
    await getEnrolmentFormData();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/dashboard/students"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to students
        </Link>
        <h1 className="text-2xl font-bold">Add student</h1>
        <p className="text-muted-foreground">
          Enrol an existing child into
          {academicYearName ? ` the ${academicYearName} academic year` : " the current academic year"}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Enrolment details</CardTitle>
          <CardDescription>
            The admission number is suggested automatically&mdash;change it if the
            child already has one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddStudentForm
            classes={classes}
            suggestedAdmissionNumber={suggestedAdmissionNumber}
          />
        </CardContent>
      </Card>
    </div>
  );
}
