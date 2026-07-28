import type { StaffRole } from "@/features/auth/types";
import { normalizeStaffRole } from "@/features/auth/permissions";

export type ReportCardCapability =
  | "REPORT_CARDS_VIEW"
  | "REPORT_CARDS_VIEW_ALL"
  | "REPORT_CARDS_EDIT_REMARKS"
  | "REPORT_CARDS_REVIEW"
  | "REPORT_CARDS_APPROVE"
  | "REPORT_CARDS_PUBLISH"
  | "REPORT_CARDS_PRINT"
  | "REPORT_CARD_SETTINGS_MANAGE";

const HEAD_CAPS: readonly ReportCardCapability[] = [
  "REPORT_CARDS_VIEW",
  "REPORT_CARDS_VIEW_ALL",
  "REPORT_CARDS_EDIT_REMARKS",
  "REPORT_CARDS_REVIEW",
  "REPORT_CARDS_APPROVE",
  "REPORT_CARDS_PUBLISH",
  "REPORT_CARDS_PRINT",
  "REPORT_CARD_SETTINGS_MANAGE",
] as const;

const TEACHER_CAPS: readonly ReportCardCapability[] = [
  "REPORT_CARDS_VIEW",
  "REPORT_CARDS_EDIT_REMARKS",
  "REPORT_CARDS_PRINT",
] as const;

export function hasReportCardCapability(
  role: StaffRole | string | null | undefined,
  capability: ReportCardCapability,
): boolean {
  const normalized = normalizeStaffRole(role);
  if (!normalized) return false;
  if (normalized === "administrator") return true;
  if (normalized === "headteacher") {
    return (HEAD_CAPS as readonly string[]).includes(capability);
  }
  if (normalized === "teacher") {
    return (TEACHER_CAPS as readonly string[]).includes(capability);
  }
  // Secretary/bursar: no default access.
  return false;
}

export function canOpenReportCards(
  role: StaffRole | string | null | undefined,
): boolean {
  return (
    hasReportCardCapability(role, "REPORT_CARDS_VIEW") ||
    hasReportCardCapability(role, "REPORT_CARDS_VIEW_ALL")
  );
}

export function canEditReportCardRemarks(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasReportCardCapability(role, "REPORT_CARDS_EDIT_REMARKS");
}

export function canReviewReportCards(
  role: StaffRole | string | null | undefined,
): boolean {
  return (
    hasReportCardCapability(role, "REPORT_CARDS_REVIEW") ||
    hasReportCardCapability(role, "REPORT_CARDS_APPROVE")
  );
}

export function canApproveReportCards(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasReportCardCapability(role, "REPORT_CARDS_APPROVE");
}

export function canPublishReportCards(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasReportCardCapability(role, "REPORT_CARDS_PUBLISH");
}

export function canPrintReportCards(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasReportCardCapability(role, "REPORT_CARDS_PRINT");
}

export function canManageReportCardSettings(
  role: StaffRole | string | null | undefined,
): boolean {
  return hasReportCardCapability(role, "REPORT_CARD_SETTINGS_MANAGE");
}
