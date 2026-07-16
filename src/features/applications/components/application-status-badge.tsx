import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { APPLICATION_STATUS_LABELS } from "@/features/applications/schemas";

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  submitted: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

export function ApplicationStatusBadge({ status }: { status: string }) {
  const label =
    (APPLICATION_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const tone = STATUS_TONE[status] ?? "neutral";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
