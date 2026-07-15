import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageStudents,
  canViewStudentMedical,
  canViewStudentProfile,
} from "@/features/auth/permissions";
import { getStudentProfile, getCurrentYearClasses } from "@/features/students/queries";
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
import { Badge } from "@/components/ui/badge";
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

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const canManageFees = Boolean(
    role && FEE_MANAGER_ROLES.includes(role),
  );
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/dashboard/students"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to students
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{student.fullName}</h1>
          <StudentStatusBadge status={student.status} />
        </div>
        <p className="text-muted-foreground font-mono text-sm">
          {student.admissionNumber}
        </p>
        {canArchive || canTransfer ? (
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
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
        ) : null}
        {student.status === "withdrawn" && student.archiveReason ? (
          <p className="text-sm text-muted-foreground">
            Archive reason: {student.archiveReason}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Student details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail
              label="Gender"
              value={
                (GENDER_LABELS as Record<string, string>)[student.gender] ??
                student.gender
              }
            />
            <Detail
              label="Date of birth"
              value={formatDate(student.dateOfBirth)}
            />
            <Detail
              label="Current class"
              value={student.currentClassName ?? "Not assigned"}
            />
            <Detail
              label="Enrollment date"
              value={formatDate(student.enrollmentDate)}
            />
            <Detail
              label="Place of birth"
              value={student.placeOfBirth ?? "-"}
            />
            <Detail
              label="Religious denomination"
              value={student.religiousDenomination ?? "-"}
            />
            <Detail
              label="Present / last school"
              value={student.previousSchool ?? "-"}
            />
            <Detail
              label="Proposed admission date"
              value={formatDate(student.proposedAdmissionDate)}
            />
            <Detail
              label="Zambian citizen"
              value={
                student.isZambianCitizen === null
                  ? "-"
                  : student.isZambianCitizen
                    ? "Yes"
                    : "No"
              }
            />
            {canSeeMedical ? (
              <>
                <Detail
                  label="Vaccinated (smallpox)"
                  value={
                    student.vaccinatedSmallpox === null
                      ? "-"
                      : student.vaccinatedSmallpox
                        ? `Yes${student.vaccinationDate ? ` (${formatDate(student.vaccinationDate)})` : ""}`
                        : "No"
                  }
                />
                <Detail
                  label="Medical notes / allergies"
                  value={student.medicalNotes ?? "-"}
                />
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Parents / guardians</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {student.guardians.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No guardians recorded.
            </p>
          ) : (
            student.guardians.map((guardian) => (
              <div
                key={guardian.id}
                className="space-y-3 rounded-lg border p-4"
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
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Detail label="Phone" value={guardian.phone ?? "-"} />
                  <Detail label="WhatsApp" value={guardian.whatsapp ?? "-"} />
                  <Detail
                    label="Alternate phone"
                    value={guardian.altPhone ?? "-"}
                  />
                  <Detail label="Email" value={guardian.email ?? "-"} />
                  <Detail
                    label="NRC / national ID"
                    value={guardian.nationalId ?? "-"}
                  />
                  <Detail
                    label="Occupation"
                    value={guardian.occupation ?? "-"}
                  />
                  <Detail
                    label="Residential address"
                    value={guardian.address ?? "-"}
                  />
                  <Detail
                    label="Postal address"
                    value={guardian.postalAddress ?? "-"}
                  />
                </dl>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fees &amp; balance</CardTitle>
          <CardDescription>
            Statement for
            {statement.academicYearName
              ? ` academic year ${statement.academicYearName}`
              : " the current academic year"}
            {statement.currentTermName
              ? ` · current term: ${statement.currentTermName}`
              : ""}
            . Generate mandatory fees first, then opt in to meals and uniforms
            below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManageFees && student.status === "enrolled" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <GenerateStudentChargesButton
                  studentId={student.id}
                  termId={statement.currentTermId}
                  termName={statement.currentTermName}
                />
                <RecordPaymentForm
                  studentId={student.id}
                  currentBalance={statement.balance}
                />
              </div>
              <OptionalFeesOptInForm
                studentId={student.id}
                termId={optionalFees.currentTermId}
                termName={optionalFees.currentTermName}
                meals={optionalFees.meals}
                uniforms={optionalFees.uniforms}
                activeMealFeeItemId={optionalFees.activeMealFeeItemId}
              />
            </div>
          ) : null}
          <FeeStatement
            statement={statement}
            studentId={student.id}
            canManageFees={canManageFees}
          />
        </CardContent>
      </Card>

      <Card>
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

      <Card>
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

      <Card>
        <CardHeader>
          <CardTitle>Discipline</CardTitle>
          <CardDescription>
            Behaviour and discipline incidents. See{" "}
            <Link href="/dashboard/rules" className="underline">
              school rules
            </Link>{" "}
            or the{" "}
            <Link href="/dashboard/discipline" className="underline">
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

      <Card>
        <CardHeader>
          <CardTitle>Enrolment history</CardTitle>
        </CardHeader>
        <CardContent>
          {student.enrolments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No class enrolments recorded.
            </p>
          ) : (
            <div className="rounded-lg border">
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
                          <Badge variant="secondary" className="ml-2">
                            Current
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{enrolment.className}</TableCell>
                      <TableCell className="capitalize">
                        {enrolment.status}
                      </TableCell>
                      <TableCell>{formatDate(enrolment.enrolledOn)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
