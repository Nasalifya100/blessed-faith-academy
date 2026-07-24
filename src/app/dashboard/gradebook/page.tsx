import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenGradebook } from "@/features/gradebook/permissions";
import { getGradebookHub } from "@/features/gradebook/queries";
import { GradebookHubView } from "@/features/gradebook/components/gradebook-hub";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, PageShell } from "@/components/layout/page-shell";

export default async function GradebookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  if (!current?.profile?.is_active) redirect("/login");
  if (!canOpenGradebook(current.profile.role)) {
    return (
      <PageShell>
        <PageHeader title="Gradebook" />
        <EmptyState
          title="Access denied"
          description="You do not have permission to view exam marks."
        />
      </PageShell>
    );
  }

  const params = await searchParams;
  const year = typeof params.year === "string" ? params.year : undefined;
  const term = typeof params.term === "string" ? params.term : undefined;
  const classId = typeof params.class === "string" ? params.class : undefined;
  const subjectId =
    typeof params.subject === "string" ? params.subject : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;

  const hub = await getGradebookHub({
    academicYearId: year,
    termId: term === "all" ? null : term,
    classId: classId === "all" ? null : classId,
    subjectId: subjectId === "all" ? null : subjectId,
    status: status === "all" ? null : status,
  });

  if (!hub) {
    return (
      <PageShell>
        <PageHeader title="Gradebook" />
        <EmptyState
          title="Access denied"
          description="You do not have permission to view exam marks."
        />
      </PageShell>
    );
  }

  return (
    <GradebookHubView
      hub={hub}
      filters={{
        year,
        term,
        classId,
        subjectId,
        status,
      }}
    />
  );
}
