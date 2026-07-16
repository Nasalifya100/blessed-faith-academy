import { ROLE_LABELS, type StaffRole } from "@/features/auth/types";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const ROLE_TONE: Record<StaffRole, StatusTone> = {
  administrator: "danger",
  headteacher: "info",
  bursar: "warning",
  secretary: "info",
  teacher: "success",
};

export function StaffRoleBadge({ role }: { role: StaffRole }) {
  return (
    <StatusBadge tone={ROLE_TONE[role]} label={`Role: ${ROLE_LABELS[role]}`}>
      {ROLE_LABELS[role]}
    </StatusBadge>
  );
}

export function StaffStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <StatusBadge
      tone={isActive ? "success" : "neutral"}
      label={isActive ? "Status: Active" : "Status: Inactive"}
    >
      {isActive ? "Active" : "Inactive"}
    </StatusBadge>
  );
}

/** Human-readable access summary from known role capabilities (no DB). */
export function permissionsSummaryForRole(role: StaffRole): string[] {
  switch (role) {
    case "administrator":
      return [
        "Full system access",
        "Manage staff accounts",
        "Students, applications, fees, attendance, discipline, reports",
      ];
    case "headteacher":
      return [
        "School leadership access",
        "Students, applications, attendance, discipline, fees, reports",
        "Cannot manage staff accounts",
      ];
    case "bursar":
      return [
        "Finance and fee balances",
        "Student directory for fee look-ups",
        "Reports related to fees",
      ];
    case "secretary":
      return [
        "Students and applications",
        "Attendance cover management",
        "Discipline case resolution",
      ];
    case "teacher":
      return [
        "Homeroom and cover attendance",
        "Student profiles for assigned work",
        "Discipline incident recording",
      ];
    default:
      return [];
  }
}

export function isOfficeRole(role: StaffRole): boolean {
  return role === "headteacher" || role === "bursar" || role === "secretary";
}
