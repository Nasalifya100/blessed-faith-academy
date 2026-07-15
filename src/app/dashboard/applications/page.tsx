import Link from "next/link";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listApplications } from "@/features/applications/queries";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
} from "@/features/applications/schemas";
import { ApplicationStatusBadge } from "@/features/applications/components/application-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Default to showing submitted applications (those awaiting review).
  const status = params.status === undefined ? "submitted" : firstValue(params.status);

  const current = await getCurrentUser();
  const role = current?.profile?.role;
  const canManage = Boolean(role && MANAGER_ROLES.includes(role));

  const applications = await listApplications(status || undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            {applications.length} application
            {applications.length === 1 ? "" : "s"}.
          </p>
        </div>
        {canManage ? (
          <Link
            href="/dashboard/applications/new"
            className={buttonVariants()}
          >
            New application
          </Link>
        ) : null}
      </div>

      <form
        method="get"
        action="/dashboard/applications"
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <SelectNative
            id="status"
            name="status"
            defaultValue={status}
            className="w-48"
          >
            <option value="">All statuses</option>
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {APPLICATION_STATUS_LABELS[value]}
              </option>
            ))}
          </SelectNative>
        </div>
        <button type="submit" className={buttonVariants()}>
          Filter
        </button>
      </form>

      {applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications found.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicant</TableHead>
                <TableHead>Admission #</TableHead>
                <TableHead>Applying for</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => (
                <TableRow key={application.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/applications/${application.id}`}
                      className="hover:underline"
                    >
                      {application.applicantName || "(unnamed)"}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {application.admissionNumber}
                  </TableCell>
                  <TableCell>{application.appliedClassName ?? "-"}</TableCell>
                  <TableCell>
                    <ApplicationStatusBadge status={application.status} />
                  </TableCell>
                  <TableCell>{formatDate(application.submittedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/applications/${application.id}`}
                      className="text-sm hover:underline"
                    >
                      Review
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
