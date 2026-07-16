import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const CHARGE_STATUS_TONE: Record<string, StatusTone> = {
  outstanding: "danger",
  partial: "warning",
  paid: "success",
  cancelled: "neutral",
  waived: "neutral",
};

const CHARGE_STATUS_LABEL: Record<string, string> = {
  outstanding: "Outstanding",
  partial: "Partial",
  paid: "Paid",
  cancelled: "Cancelled",
  waived: "Waived",
};

export function ChargeStatusBadge({ status }: { status: string }) {
  const label = CHARGE_STATUS_LABEL[status] ?? status;
  const tone = CHARGE_STATUS_TONE[status] ?? "neutral";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function PaymentStatusBadge({
  status,
}: {
  status: "completed" | "voided" | string;
}) {
  if (status === "voided") {
    return <StatusBadge tone="neutral">Reversed</StatusBadge>;
  }
  return <StatusBadge tone="success">Completed</StatusBadge>;
}

export function statementBalanceStatus(
  balance: number,
  totalPaid: number,
  totalCharged: number,
): "outstanding" | "partial" | "paid" | "cancelled" {
  if (totalCharged <= 0) return "cancelled";
  if (balance <= 0) return "paid";
  if (totalPaid > 0) return "partial";
  return "outstanding";
}
