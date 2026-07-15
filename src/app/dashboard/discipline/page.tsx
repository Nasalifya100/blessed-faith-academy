import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listSchoolDisciplineIncidents } from "@/features/discipline/queries";
import type { DisciplineStatus } from "@/features/discipline/schemas";
import { SchoolDisciplineList } from "@/features/discipline/components/school-discipline-list";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const VIEWER_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
];
const RESOLVE_ROLES = ["administrator", "headteacher", "secretary"];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function DisciplinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !VIEWER_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const statusParam = firstValue(params.status) || "open";
  const statusFilter =
    statusParam === "all" || statusParam === "resolved" || statusParam === "open"
      ? statusParam
      : "open";

  const canResolve = Boolean(
    current?.profile?.is_active && RESOLVE_ROLES.includes(role),
  );

  const incidents = await listSchoolDisciplineIncidents({
    status: statusFilter as DisciplineStatus | "all",
  });

  const filters: { value: string; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "resolved", label: "Resolved" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Discipline</h1>
          <p className="text-muted-foreground">
            School-wide incident list. Record new incidents from a student
            profile.
          </p>
        </div>
        <Link
          href="/dashboard/rules"
          className={buttonVariants({ variant: "outline" })}
        >
          School rules
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.value}
            href={`/dashboard/discipline?status=${filter.value}`}
            className={buttonVariants({
              variant: statusFilter === filter.value ? "default" : "outline",
              size: "sm",
            })}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === "open"
              ? "Open incidents"
              : statusFilter === "resolved"
                ? "Resolved incidents"
                : "All incidents"}
          </CardTitle>
          <CardDescription>
            {incidents.length} shown
            {canResolve && statusFilter !== "resolved"
              ? " · Resolve from here or on the student profile"
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchoolDisciplineList
            incidents={incidents}
            canResolve={canResolve}
          />
        </CardContent>
      </Card>
    </div>
  );
}
