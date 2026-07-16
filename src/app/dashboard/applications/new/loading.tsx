import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";

export default function NewApplicationLoading() {
  return (
    <PageShell width="form">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="h-[32rem] rounded-xl" />
    </PageShell>
  );
}
