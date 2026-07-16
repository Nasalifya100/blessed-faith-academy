import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileText,
  StickyNote,
  Users,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageApplications,
  canViewStudentMedical,
} from "@/features/auth/permissions";
import {
  getApplicationDetail,
  type ApplicationDetail,
} from "@/features/applications/queries";
import { getCurrentYearClasses } from "@/features/students/queries";
import { GENDER_LABELS, RELATIONSHIP_LABELS } from "@/features/students/schemas";
import { ApplicationStatusBadge } from "@/features/applications/components/application-status-badge";
import { ApplicationTimeline } from "@/features/applications/components/application-timeline";
import { ReviewActions } from "@/features/applications/components/review-actions";
import { StudentAvatar } from "@/features/students/components/student-avatar";
import { BackLink, PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REVIEWER_ROLES = ["administrator", "headteacher"];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function Detail({ label, value }: { label: string; value: string }) {
  const missing = !value || value === "—";
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm",
          missing && "font-medium text-amber-800 dark:text-amber-200",
        )}
      >
        {missing ? "Missing" : value}
      </dd>
    </div>
  );
}

function ChecklistItem({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border px-3 py-2.5">
      {ok ? (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-emerald-600"
          aria-hidden
        />
      ) : (
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-amber-600"
          aria-hidden
        />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {detail ? (
          <p className="text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
    </li>
  );
}

function collectGaps(application: ApplicationDetail): string[] {
  const gaps: string[] = [];
  if (!application.student) gaps.push("Applicant profile");
  if (!application.appliedClass) gaps.push("Applied class");
  if (application.guardians.length === 0) gaps.push("Guardian information");
  const hasPrimary = application.guardians.some((g) => g.isPrimary);
  if (application.guardians.length > 0 && !hasPrimary) {
    gaps.push("Primary guardian contact");
  }
  const primary = application.guardians.find((g) => g.isPrimary);
  if (primary && !primary.phone) gaps.push("Primary guardian phone");
  if (!application.consentAgreed) gaps.push("Parent declaration consent");
  if (!application.consentSignedBy?.trim()) gaps.push("Consent signed-by name");
  if (!application.emergencyContactPhone?.trim()) {
    gaps.push("Emergency contact phone");
  }
  return gaps;
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
  if (!canManageApplications(role)) {
    redirect("/dashboard");
  }
  const canReview = Boolean(role && REVIEWER_ROLES.includes(role));
  const canSeeMedical = canViewStudentMedical(role);
  const isPending =
    application.status === "submitted" || application.status === "draft";
  const gaps = collectGaps(application);
  const displayName = application.student?.fullName ?? "Application";
  const primaryGuardian =
    application.guardians.find((g) => g.isPrimary) ??
    application.guardians[0] ??
    null;

  return (
    <PageShell>
      <header className="space-y-4">
        <BackLink href="/dashboard/applications">
          Back to applications
        </BackLink>
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-4">
            <StudentAvatar name={displayName} className="size-14 text-lg" />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {displayName}
                </h1>
                <ApplicationStatusBadge status={application.status} />
              </div>
              <p className="font-mono text-sm text-muted-foreground">
                {application.student?.admissionNumber ?? "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Applying for{" "}
                <span className="font-medium text-foreground">
                  {application.appliedClass?.name ?? "—"}
                </span>
                {primaryGuardian ? (
                  <>
                    {" · "}
                    Guardian{" "}
                    <span className="font-medium text-foreground">
                      {primaryGuardian.fullName}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          {application.status === "approved" && application.student ? (
            <Link
              href={`/dashboard/students/${application.student.id}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              View enrolled student
            </Link>
          ) : null}
        </div>
      </header>

      {gaps.length > 0 && isPending ? (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold">Missing information</p>
            <p className="text-sm">
              {gaps.join(" · ")}. Review carefully before approving.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" aria-hidden />
                Student details
              </CardTitle>
              <CardDescription>
                Applicant profile captured at submission.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Detail
                  label="Gender"
                  value={
                    application.student
                      ? ((GENDER_LABELS as Record<string, string>)[
                          application.student.gender
                        ] ?? application.student.gender)
                      : "—"
                  }
                />
                <Detail
                  label="Date of birth"
                  value={formatDate(application.student?.dateOfBirth ?? null)}
                />
                <Detail
                  label="Applying for"
                  value={application.appliedClass?.name ?? "—"}
                />
                <Detail
                  label="Place of birth"
                  value={application.student?.placeOfBirth ?? "—"}
                />
                <Detail
                  label="Religious denomination"
                  value={application.student?.religiousDenomination ?? "—"}
                />
                <Detail
                  label="Present / last school"
                  value={application.student?.previousSchool ?? "—"}
                />
                <Detail
                  label="Proposed admission date"
                  value={formatDate(
                    application.student?.proposedAdmissionDate ?? null,
                  )}
                />
                <Detail
                  label="Zambian citizen"
                  value={
                    application.student?.isZambianCitizen === null ||
                    application.student?.isZambianCitizen === undefined
                      ? "—"
                      : application.student.isZambianCitizen
                        ? "Yes"
                        : "No"
                  }
                />
                {canSeeMedical ? (
                  <>
                    <Detail
                      label="Vaccinated (smallpox)"
                      value={
                        application.student?.vaccinatedSmallpox === null ||
                        application.student?.vaccinatedSmallpox === undefined
                          ? "—"
                          : application.student.vaccinatedSmallpox
                            ? `Yes${
                                application.student.vaccinationDate
                                  ? ` (${formatDate(application.student.vaccinationDate)})`
                                  : ""
                              }`
                            : "No"
                      }
                    />
                    <Detail
                      label="Medical notes / allergies"
                      value={application.student?.medicalNotes ?? "—"}
                    />
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Guardian information</CardTitle>
              <CardDescription>
                Contacts responsible for this applicant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {application.guardians.length === 0 ? (
                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-6 text-center text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                  No guardians recorded.
                </div>
              ) : (
                application.guardians.map((guardian) => (
                  <div
                    key={guardian.id}
                    className="space-y-3 rounded-xl border bg-muted/20 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{guardian.fullName}</p>
                      <StatusBadge tone="neutral">
                        {(RELATIONSHIP_LABELS as Record<string, string>)[
                          guardian.relationship
                        ] ?? guardian.relationship}
                      </StatusBadge>
                      {guardian.isPrimary ? (
                        <StatusBadge tone="success">Primary contact</StatusBadge>
                      ) : null}
                      {guardian.isEmergency ? (
                        <StatusBadge tone="warning">Emergency contact</StatusBadge>
                      ) : null}
                    </div>
                    <dl className="grid gap-4 sm:grid-cols-3">
                      <Detail label="Phone" value={guardian.phone ?? "—"} />
                      <Detail
                        label="WhatsApp"
                        value={guardian.whatsapp ?? "—"}
                      />
                      <Detail label="Email" value={guardian.email ?? "—"} />
                    </dl>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                Required documents
              </CardTitle>
              <CardDescription>
                Declaration and consent items on this application.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                <ChecklistItem
                  label="Parent declaration"
                  ok={application.consentAgreed}
                  detail={
                    application.consentAgreed
                      ? `Agreed by ${application.consentSignedBy ?? "—"} on ${formatDate(application.consentSignedAt)}`
                      : "Consent not recorded"
                  }
                />
                <ChecklistItem
                  label="Emergency medical authorization"
                  ok={Boolean(application.emergencyContactPhone?.trim())}
                  detail={
                    application.emergencyContactPhone?.trim()
                      ? application.emergencyContactPhone
                      : "Phone missing"
                  }
                />
                <ChecklistItem
                  label="Media release"
                  ok={application.mediaReleaseAgreed}
                  detail={
                    application.mediaReleaseAgreed
                      ? "Permission granted"
                      : "Not granted (optional)"
                  }
                />
                <ChecklistItem
                  label="Applied class selection"
                  ok={Boolean(application.appliedClass)}
                  detail={application.appliedClass?.name ?? "Not selected"}
                />
              </ul>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Requirements checklist</CardTitle>
              <CardDescription>
                Readiness signals before enrolment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                <ChecklistItem
                  label="Applicant profile"
                  ok={Boolean(application.student)}
                />
                <ChecklistItem
                  label="At least one guardian"
                  ok={application.guardians.length > 0}
                />
                <ChecklistItem
                  label="Primary contact"
                  ok={application.guardians.some((g) => g.isPrimary)}
                />
                <ChecklistItem
                  label="Consent complete"
                  ok={
                    application.consentAgreed &&
                    Boolean(application.consentSignedBy?.trim())
                  }
                />
                <ChecklistItem
                  label="Emergency phone"
                  ok={Boolean(application.emergencyContactPhone?.trim())}
                />
                <ChecklistItem
                  label="Submitted for review"
                  ok={Boolean(application.submittedAt)}
                  detail={
                    application.submittedAt
                      ? formatDate(application.submittedAt)
                      : "Still a draft"
                  }
                />
              </ul>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StickyNote
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                School notes
              </CardTitle>
              <CardDescription>
                Decision notes and review comments from this record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {application.decisionNotes ? (
                <p className="rounded-xl border bg-muted/30 px-4 py-3 text-sm whitespace-pre-wrap">
                  {application.decisionNotes}
                </p>
              ) : (
                <EmptyState
                  title="No school notes yet"
                  description={
                    isPending
                      ? "Rejection requires a reason, which will appear here."
                      : undefined
                  }
                  size="sm"
                />
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <ApplicationTimeline application={application} />

          {isPending && canReview ? (
            <Card className="border-2 shadow-sm">
              <CardHeader>
                <CardTitle>Decision panel</CardTitle>
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
                  missingItems={gaps}
                />
              </CardContent>
            </Card>
          ) : null}

          {isPending && !canReview ? (
            <Card className="shadow-sm">
              <CardContent className="flex gap-3 pt-6">
                <Circle
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">
                  This application is awaiting review by an administrator or
                  headteacher.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </PageShell>
  );
}
