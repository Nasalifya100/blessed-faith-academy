import { Badge } from "@/components/ui/badge";
import { STUDENT_STATUS_LABELS } from "@/features/students/schemas";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "outline";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  enrolled: "success",
  applicant: "secondary",
  withdrawn: "destructive",
  rejected: "destructive",
  graduated: "outline",
};

export function StudentStatusBadge({ status }: { status: string }) {
  const label =
    (STUDENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const variant = STATUS_VARIANT[status] ?? "outline";
  return <Badge variant={variant}>{label}</Badge>;
}
