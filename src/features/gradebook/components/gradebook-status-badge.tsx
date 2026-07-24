import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  GRADEBOOK_STATUS_LABELS,
  type GradebookStatus,
} from "@/features/gradebook/schemas";

const TONE: Record<GradebookStatus | "READY", StatusTone> = {
  READY: "info",
  DRAFT: "warning",
  REOPENED: "warning",
  SUBMITTED: "success",
  LOCKED: "neutral",
};

export function GradebookStatusBadge({
  status,
}: {
  status: GradebookStatus | "READY";
}) {
  const label =
    status === "READY" ? "Ready to start" : GRADEBOOK_STATUS_LABELS[status];
  return <StatusBadge tone={TONE[status]}>{label}</StatusBadge>;
}
