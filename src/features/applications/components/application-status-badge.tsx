import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATUS_LABELS } from "@/features/applications/schemas";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "outline";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  submitted: "secondary",
  approved: "success",
  rejected: "destructive",
  draft: "outline",
  withdrawn: "outline",
};

export function ApplicationStatusBadge({ status }: { status: string }) {
  const label =
    (APPLICATION_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const variant = STATUS_VARIANT[status] ?? "outline";
  return <Badge variant={variant}>{label}</Badge>;
}
