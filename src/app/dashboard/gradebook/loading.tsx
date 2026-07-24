import { PageShell } from "@/components/layout/page-shell";

export default function GradebookLoading() {
  return (
    <PageShell>
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-48 rounded-xl bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-40 rounded-2xl bg-muted" />
      </div>
    </PageShell>
  );
}
