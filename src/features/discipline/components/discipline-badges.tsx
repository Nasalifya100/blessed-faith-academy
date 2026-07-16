import {
  DISCIPLINE_SEVERITY_LABELS,
  DISCIPLINE_STATUS_LABELS,
  type DisciplineSeverity,
  type DisciplineStatus,
} from "@/features/discipline/schemas";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const SEVERITY_TONE: Record<DisciplineSeverity, StatusTone> = {
  low: "info",
  medium: "warning",
  high: "danger",
};

const STATUS_TONE: Record<DisciplineStatus, StatusTone> = {
  open: "warning",
  resolved: "success",
};

export function DisciplineSeverityBadge({
  severity,
}: {
  severity: DisciplineSeverity;
}) {
  return (
    <StatusBadge tone={SEVERITY_TONE[severity]}>
      {DISCIPLINE_SEVERITY_LABELS[severity]}
    </StatusBadge>
  );
}

export function DisciplineStatusBadge({
  status,
}: {
  status: DisciplineStatus;
}) {
  return (
    <StatusBadge tone={STATUS_TONE[status]}>
      {DISCIPLINE_STATUS_LABELS[status]}
    </StatusBadge>
  );
}
