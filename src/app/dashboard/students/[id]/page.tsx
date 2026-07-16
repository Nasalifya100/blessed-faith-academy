import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileQuestion } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageStudents,
  canViewStudentMedical,
  canViewStudentProfile,
} from "@/features/auth/permissions";
import {
  getStudentProfile,
  getCurrentYearClasses,
} from "@/features/students/queries";
import {
  getOptionalFeeOptions,
  getStudentFeeStatement,
  getStudentRequirementsChecklist,
} from "@/features/fees/queries";
import { getStudentAttendanceHistory } from "@/features/attendance/queries";
import {
  listSchoolRules,
  listStudentDisciplineIncidents,
} from "@/features/discipline/queries";
import {
  GENDER_LABELS,
  RELATIONSHIP_LABELS,
} from "@/features/students/schemas";
import { StudentStatusBadge } from "@/features/students/components/status-badge";
import { StudentAvatar } from "@/features/students/components/student-avatar";
import { StudentTimeline } from "@/features/students/components/student-timeline";
import { ArchiveStudentButton } from "@/features/students/components/archive-student-button";
import { TransferStudentClassForm } from "@/features/students/components/transfer-student-class-form";
import { FeeStatement } from "@/features/fees/components/fee-statement";
import { GenerateStudentChargesButton } from "@/features/fees/components/generate-student-charges-button";
import { OptionalFeesOptInForm } from "@/features/fees/components/optional-fees-opt-in-form";
import { RecordPaymentForm } from "@/features/fees/components/record-payment-form";
import { RequirementsChecklist } from "@/features/fees/components/requirements-checklist";
import { StudentAttendanceHistoryView } from "@/features/attendance/components/student-attendance-history";
import { RecordDisciplineIncidentForm } from "@/features/discipline/components/record-discipline-incident-form";
import { StudentDisciplineList } from "@/features/discipline/components/student-discipline-list";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FEE_MANAGER_ROLES = ["administrator", "bursar", "headteacher"];
const REQUIREMENT_TRACKER_ROLES = [
  "administrator",
  "bursar",
  "headteacher",
  "secretary",
];
const DISCIPLINE_RECORD_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const DISCIPLINE_RESOLVE_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
];

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
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      icon={
        <FileQuestion className="size-6 text-muted-foreground" aria-hidden />
      }
      size="sm"
    />
  );
}

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const allowedTabs = new Set([
    "overview",
    "guardians",
    "fees",
    "attendance",
    "discipline",
    "documents",
    "medical",
    "timeline",
  ]);
  const defaultTab =
    tabParam && allowedTabs.has(tabParam) ? tabParam : "overview";
  const [
    student,
    current,
    statement,
    optionalFees,
    requirements,
    attendance,
    incidents,
    rules,
    yearClasses,
  ] = await Promise.all([
    getStudentProfile(id),
    getCurrentUser(),
    getStudentFeeStatement(id),
    getOptionalFeeOptions(id),
    getStudentRequirementsChecklist(id),
    getStudentAttendanceHistory(id),
    listStudentDisciplineIncidents(id),
    listSchoolRules({ activeOnly: true }),
    getCurrentYearClasses(),
  ]);

  if (!student) {
    notFound();
  }

  const role = current?.profile?.role;
  if (!canViewStudentProfile(role)) {
    redirect("/dashboard");
  }
  const canManageFees = Boolean(role && FEE_MANAGER_ROLES.includes(role));
  const canTrackRequirements = Boolean(
    current?.profile?.is_active &&
      role &&
      REQUIREMENT_TRACKER_ROLES.includes(role),
  );
  const canRecordDiscipline = Boolean(
    current?.profile?.is_active &&
      role &&
      DISCIPLINE_RECORD_ROLES.includes(role),
  );
  const canResolveDiscipline = Boolean(
    current?.profile?.is_active &&
      role &&
      DISCIPLINE_RESOLVE_ROLES.includes(role),
  );
  const canSeeMedical = canViewStudentMedical(role);
  const canArchive =
    Boolean(current?.profile?.is_active) &&
    canManageStudents(role) &&
    student.status !== "withdrawn";
  const canTransfer =
    Boolean(current?.profile?.is_active) &&
    canManageStudents(role) &&
    student.status === "enrolled" &&
    Boolean(student.currentClassId) &&
    yearClasses.classes.length > 1;

  const primaryGuardian =
    student.guardians.find((g) => g.isPrimary) ?? student.guardians[0] ?? null;

  return (
    <PageShell>
      <div className="space-y-4">
        <BackLink href="/dashboard/students">Back to students</BackLink>

        <Card className="shadow-sm">
          <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <StudentAvatar
                name={student.fullName}
                className="size-16 text-base"
              />
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {student.fullName}
                  </h1>
                  <StudentStatusBadge status={student.status} />
                </div>
                <p className="font-mono text-sm text-muted-foreground">
                  {student.admissionNumber}
                </p>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Detail
                    label="Class / grade"
                    value={student.currentClassName ?? "Not assigned"}
                  />
                  <Detail
                    label="Primary guardian"
                    value={primaryGuardian?.fullName ?? "—"}
                  />
                  <Detail
                    label="Enrollment date"
                    value={formatDate(student.enrollmentDate)}
                  />
                </dl>
                {student.status === "withdrawn" && student.archiveReason ? (
                  <p className="text-sm text-muted-foreground">
                    Archive reason: {student.archiveReason}
                  </p>
                ) : null}
              </div>
            </div>

            {(canArchive || canTransfer) && (
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-56">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Quick actions
                </p>
                {canTransfer ? (
                  <TransferStudentClassForm
                    studentId={student.id}
                    studentName={student.fullName}
                    currentClassId={student.currentClassId}
                    classes={yearClasses.classes}
                  />
                ) : null}
                {canArchive ? (
                  <ArchiveStudentButton
                    studentId={student.id}
                    studentName={student.fullName}
                  />
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={defaultTab} key={defaultTab}>
        <TabsList aria-label="Student profile sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="guardians">Guardians</TabsTrigger>
          <TabsTrigger value="fees">Fees</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="discipline">Discipline</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="medical">Medical</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Student details</CardTitle>
                <CardDescription>Core identity and enrolment facts</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Detail
                    label="Gender"
                    value={
                      (GENDER_LABELS as Record<string, string>)[
                        student.gender
                      ] ?? student.gender
                    }
                  />
                  <Detail
                    label="Date of birth"
                    value={formatDate(student.dateOfBirth)}
                  />
                  <Detail
                    label="Place of birth"
                    value={student.placeOfBirth ?? "—"}
                  />
                  <Detail
                    label="Religious denomination"
                    value={student.religiousDenomination ?? "—"}
                  />
                  <Detail
                    label="Present / last school"
                    value={student.previousSchool ?? "—"}
                  />
                  <Detail
                    label="Proposed admission date"
                    value={formatDate(student.proposedAdmissionDate)}
                  />
                  <Detail
                    label="Zambian citizen"
                    value={
                      student.isZambianCitizen === null
                        ? "—"
                        : student.isZambianCitizen
                          ? "Yes"
                          : "No"
                    }
                  />
                </dl>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Enrolment history</CardTitle>
                <CardDescription>Class placements by academic year</CardDescription>
              </CardHeader>
              <CardContent>
                {student.enrolments.length === 0 ? (
                  <EmptyPanel
                    title="No enrolments recorded"
                    description="Class placements for this pupil will appear here."
                  />
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Academic year</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Enrolled on</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {student.enrolments.map((enrolment) => (
                          <TableRow key={enrolment.id}>
                            <TableCell>
                              {enrolment.academicYearName}
                              {enrolment.isCurrent ? (
                                <StatusBadge tone="info" className="ml-2">
                                  Current
                                </StatusBadge>
                              ) : null}
                            </TableCell>
                            <TableCell>{enrolment.className}</TableCell>
                            <TableCell className="capitalize">
                              {enrolment.status}
                            </TableCell>
                            <TableCell>
                              {formatDate(enrolment.enrolledOn)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="guardians">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Parents / guardians</CardTitle>
              <CardDescription>
                Contacts linked to this student record
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {student.guardians.length === 0 ? (
                <EmptyPanel
                  title="No guardians recorded"
                  description="Add guardians when enrolling or updating the student record."
                />
              ) : (
                student.guardians.map((guardian) => (
                  <div
                    key={guardian.id}
                    className="space-y-4 rounded-xl border p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StudentAvatar name={guardian.fullName} />
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
                    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Detail label="Phone" value={guardian.phone ?? "—"} />
                      <Detail
                        label="WhatsApp"
                        value={guardian.whatsapp ?? "—"}
                      />
                      <Detail
                        label="Alternate phone"
                        value={guardian.altPhone ?? "—"}
                      />
                      <Detail label="Email" value={guardian.email ?? "—"} />
                      <Detail
                        label="NRC / national ID"
                        value={guardian.nationalId ?? "—"}
                      />
                      <Detail
                        label="Occupation"
                        value={guardian.occupation ?? "—"}
                      />
                      <Detail
                        label="Residential address"
                        value={guardian.address ?? "—"}
                      />
                      <Detail
                        label="Postal address"
                        value={guardian.postalAddress ?? "—"}
                      />
                    </dl>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fees" className="space-y-6">
          {canManageFees && student.status === "enrolled" ? (
            <section
              aria-label="Fee management actions"
              className="grid gap-4 lg:grid-cols-2"
            >
              <GenerateStudentChargesButton
                studentId={student.id}
                termId={statement.currentTermId}
                termName={statement.currentTermName}
              />
              <RecordPaymentForm
                studentId={student.id}
                currentBalance={statement.balance}
                studentName={student.fullName}
              />
              <div className="lg:col-span-2">
                <OptionalFeesOptInForm
                  studentId={student.id}
                  termId={optionalFees.currentTermId}
                  termName={optionalFees.currentTermName}
                  meals={optionalFees.meals}
                  uniforms={optionalFees.uniforms}
                  activeMealFeeItemId={optionalFees.activeMealFeeItemId}
                />
              </div>
            </section>
          ) : null}
          <FeeStatement
            statement={statement}
            studentId={student.id}
            studentName={student.fullName}
            admissionNumber={student.admissionNumber}
            studentGradeName={
              yearClasses.classes.find((c) => c.id === student.currentClassId)
                ?.gradeName ?? student.currentClassName
            }
            studentClassName={
              yearClasses.classes.find((c) => c.id === student.currentClassId)
                ?.name ?? student.currentClassName
            }
            studentStatus={student.status}
            canManageFees={canManageFees}
          />
        </TabsContent>

        <TabsContent value="attendance">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Attendance</CardTitle>
              <CardDescription>
                Register marks for the current academic year.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StudentAttendanceHistoryView history={attendance} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discipline">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Discipline</CardTitle>
              <CardDescription>
                Behaviour incidents. See{" "}
                <Link
                  href="/dashboard/rules"
                  className="underline underline-offset-2"
                >
                  school rules
                </Link>{" "}
                or the{" "}
                <Link
                  href="/dashboard/discipline"
                  className="underline underline-offset-2"
                >
                  school-wide list
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canRecordDiscipline ? (
                <RecordDisciplineIncidentForm
                  studentId={student.id}
                  rules={rules}
                />
              ) : null}
              <StudentDisciplineList
                studentId={student.id}
                incidents={incidents}
                canResolve={canResolveDiscipline}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Requirements checklist</CardTitle>
              <CardDescription>
                Tick items as parents bring them in. This is not billed as money.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RequirementsChecklist
                studentId={student.id}
                academicYearName={requirements.academicYearName}
                gradeLevelName={requirements.gradeLevelName}
                band={requirements.band}
                items={requirements.items}
                receivedCount={requirements.receivedCount}
                totalCount={requirements.totalCount}
                canEdit={canTrackRequirements}
              />
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Uploaded documents</CardTitle>
              <CardDescription>
                File uploads are not part of this release.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyPanel
                title="No document uploads yet"
                description="When document storage is enabled, birth certificates and related files will appear here."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="medical">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Medical</CardTitle>
              <CardDescription>
                Sensitive health information for authorised staff only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canSeeMedical ? (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Detail
                    label="Vaccinated (smallpox)"
                    value={
                      student.vaccinatedSmallpox === null
                        ? "—"
                        : student.vaccinatedSmallpox
                          ? `Yes${student.vaccinationDate ? ` (${formatDate(student.vaccinationDate)})` : ""}`
                          : "No"
                    }
                  />
                  <Detail
                    label="Medical notes / allergies"
                    value={student.medicalNotes ?? "—"}
                  />
                </dl>
              ) : (
                <EmptyPanel
                  title="Medical details restricted"
                  description="Your role cannot view medical notes for this student."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <StudentTimeline
            enrollmentDate={student.enrollmentDate}
            enrolments={student.enrolments}
            payments={[...statement.payments, ...statement.voidedPayments]}
            corrections={attendance.corrections}
            incidents={incidents}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
