import Link from "next/link";
import { notFound } from "next/navigation";

import { getStudentProfile } from "@/features/students/queries";
import {
  GENDER_LABELS,
  RELATIONSHIP_LABELS,
} from "@/features/students/schemas";
import { StudentStatusBadge } from "@/features/students/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
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
  const student = await getStudentProfile(id);

  if (!student) {
    notFound();
  }

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
