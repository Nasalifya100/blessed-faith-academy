import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";

export default function ReceiptLoading() {
  return (
    <PageShell width="narrow">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-96 rounded-xl" />
    </PageShell>
  );
}
