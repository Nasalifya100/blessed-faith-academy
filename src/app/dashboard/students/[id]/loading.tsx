import { PageShell } from "@/components/layout/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function StudentProfileLoading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </PageShell>
  );
}
