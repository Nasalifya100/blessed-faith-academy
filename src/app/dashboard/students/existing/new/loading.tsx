import { PageShell } from "@/components/layout/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function AddExistingStudentLoading() {
  return (
    <PageShell width="form">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </PageShell>
  );
}
