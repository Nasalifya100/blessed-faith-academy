import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getApplicationDetail } from "@/features/applications/queries";
import { getCurrentYearClasses } from "@/features/students/queries";
import { GENDER_LABELS, RELATIONSHIP_LABELS } from "@/features/students/schemas";
import { ApplicationStatusBadge } from "@/features/applications/components/application-status-badge";
import { ReviewActions } from "@/features/applications/components/review-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const REVIEWER_ROLES = ["administrator", "headteacher"];

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [application, current, { classes }] = await Promise.all([
    getApplicationDetail(id),
    getCurrentUser(),
    getCurrentYearClasses(),
  ]);

  if (!application) {
    notFound();
  }

  const role = current?.profile?.role;
  const canReview = Boolean(role && REVIEWER_ROLES.includes(role));
  const isPending =
    application.status === "submitted" || application.status === "draft";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/dashboard/applications"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to applications
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">
            {application.student?.fullName ?? "Application"}
          </h1>
          <ApplicationStatusBadge status={application.status} />
        </div>
        <p className="font-mono text-sm text-muted-foreground">
          {application.student?.admissionNumber ?? ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Applicant details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail
              label="Gender"
              value={
                application.student
                  ? ((GENDER_LABELS as Record<string, string>)[
                      application.student.gender
                    ] ?? application.student.gender)
                  : "-"
              }
            />
            <Detail
              label="Date of birth"
              value={formatDate(application.student?.dateOfBirth ?? null)}
            />
            <Detail
              label="Applying for"
              value={application.appliedClass?.name ?? "-"}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Parents / guardians</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {application.guardians.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No guardians recorded.
            </p>
          ) : (
            application.guardians.map((guardian) => (
              <div
                key={guardian.id}
                className="space-y-2 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{guardian.fullName}</p>
                  <Badge variant="outline">
                    {(RELATIONSHIP_LABELS as Record<string, string>)[
                      guardian.relationship
                    ] ?? guardian.relationship}
                  </Badge>
                  {guardian.isPrimary ? (
                    <Badge variant="success">Primary contact</Badge>
                  ) : null}
                  {guardian.isEmergency ? (
                    <Badge variant="secondary">Emergency contact</Badge>
                  ) : null}
                </div>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Detail label="Phone" value={guardian.phone ?? "-"} />
                  <Detail label="Email" value={guardian.email ?? "-"} />
                </dl>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Declaration &amp; review</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail
              label="Consent agreed"
              value={application.consentAgreed ? "Yes" : "No"}
            />
            <Detail
              label="Agreed by"
              value={application.consentSignedBy ?? "-"}
            />
            <Detail
              label="Declaration date"
              value={formatDate(application.consentSignedAt)}
            />
            <Detail
              label="Submitted"
              value={`${formatDate(application.submittedAt)}${
                application.submittedByName
                  ? ` by ${application.submittedByName}`
                  : ""
              }`}
            />
            {application.reviewedAt ? (
              <Detail
                label="Reviewed"
                value={`${formatDate(application.reviewedAt)}${
                  application.reviewedByName
                    ? ` by ${application.reviewedByName}`
                    : ""
                }`}
              />
            ) : null}
            {application.decisionNotes ? (
              <Detail label="Notes" value={application.decisionNotes} />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {isPending && canReview ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
            <CardDescription>
              Approving enrols the applicant into the chosen class for the
              current academic year.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewActions
              applicationId={application.id}
              classes={classes}
              defaultClassId={application.appliedClass?.id ?? null}
            />
          </CardContent>
        </Card>
      ) : null}

      {application.status === "approved" && application.student ? (
        <Link
          href={`/dashboard/students/${application.student.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          View enrolled student
        </Link>
      ) : null}

      {isPending && !canReview ? (
        <p className="text-sm text-muted-foreground">
          This application is awaiting review by an administrator or headteacher.
        </p>
      ) : null}
    </div>
  );
}
