import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";

export default function ApplicationDetailLoading() {
  return (
    <PageShell>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </PageShell>
  );
}
