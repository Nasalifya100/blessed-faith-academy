import { PageShell } from "@/components/layout/page-shell";

export default function GradebookEntryLoading() {
  return (
    <PageShell width="wide">
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-40 rounded bg-muted" />
        <div className="h-10 w-72 rounded-xl bg-muted" />
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-96 rounded-2xl bg-muted" />
      </div>
    </PageShell>
  );
}
