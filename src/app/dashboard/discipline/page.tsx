import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listSchoolDisciplineIncidents } from "@/features/discipline/queries";
import type { DisciplineStatus } from "@/features/discipline/schemas";
import { SchoolDisciplineList } from "@/features/discipline/components/school-discipline-list";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    statusParam === "all" ||
    statusParam === "resolved" ||
    statusParam === "open"
      ? statusParam
      : "open";

  const canResolve = Boolean(
    current?.profile?.is_active && RESOLVE_ROLES.includes(role),
  );

  // Load full list once (existing query) so overview StatCards can use open + resolved.
  const incidents = await listSchoolDisciplineIncidents({
    status: "all",
    limit: 100,
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Discipline"
        description="See open cases, what needs action, and resolve incidents. Record new cases from a student profile."
        breadcrumb={
          <BackLink href="/dashboard" className="print:hidden">
            Back to dashboard
          </BackLink>
        }
        actions={
          <Link
            href="/dashboard/rules"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            School rules
          </Link>
        }
      />

      <SchoolDisciplineList
        key={statusFilter}
        incidents={incidents}
        canResolve={canResolve}
        initialStatus={statusFilter as DisciplineStatus | "all"}
      />
    </PageShell>
  );
}
