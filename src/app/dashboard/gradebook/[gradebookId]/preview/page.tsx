import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canOpenGradebook } from "@/features/gradebook/permissions";
import { loadGradebookWorkspace } from "@/features/gradebook/queries";
import { MarksEntryWorkspace } from "@/features/gradebook/components/marks-entry-workspace";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, PageShell } from "@/components/layout/page-shell";

export default async function GradebookPreviewPage({
  params,
}: {
  params: Promise<{ gradebookId: string }>;
}) {
  const current = await getCurrentUser();
  if (!current?.profile?.is_active) redirect("/login");
  if (!canOpenGradebook(current.profile.role)) {
    return (
      <PageShell>
        <PageHeader title="Gradebook preview" />
        <EmptyState
          title="Access denied"
          description="You do not have permission to view this gradebook."
        />
      </PageShell>
    );
  }

  const { gradebookId } = await params;
  const workspace = await loadGradebookWorkspace(gradebookId);
  if (!workspace) notFound();

  if (
    workspace.open.gradebook.status !== "DRAFT" &&
    workspace.open.gradebook.status !== "REOPENED"
  ) {
    redirect(`/dashboard/gradebook/${gradebookId}`);
  }

  if (workspace.capabilities.can_edit === false) {
    redirect(`/dashboard/gradebook/${gradebookId}`);
  }

  return (
    <MarksEntryWorkspace
      key={`${workspace.open.gradebook.id}-${workspace.open.gradebook.revision}-preview`}
      workspace={workspace}
      mode="preview"
    />
  );
}
