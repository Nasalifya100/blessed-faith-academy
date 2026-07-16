import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { STUDENT_STATUS_LABELS } from "@/features/students/schemas";

const STATUS_TONE: Record<string, StatusTone> = {
  enrolled: "success",
  applicant: "info",
  withdrawn: "danger",
  rejected: "danger",
  graduated: "neutral",
};

export function StudentStatusBadge({ status }: { status: string }) {
  const label =
    (STUDENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const tone = STATUS_TONE[status] ?? "neutral";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
