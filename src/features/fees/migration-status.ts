/**
 * Pure helpers for finance allocation migration readiness display.
 * No secrets, SQL, or activation side effects.
 */

export type FinanceMode = "legacy" | "allocation_enabled";

export type FinanceBackfillStatus =
  | "not_started"
  | "completed"
  | "unavailable";

export type FinanceValidationStatus =
  | "not_run"
  | "ok"
  | "failed"
  | "recorded";

export type FinanceActivationStatus = "legacy" | "enabled";

export interface FinanceDiagnosticSummary {
  safeToBackfill: boolean;
  blockingIssueCount: number;
  warningCount: number;
  completedPaymentsCount: number;
  voidedPaymentsCount: number;
  activeChargesCount: number;
  totalCompletedPayments: number;
  totalActiveCharges: number;
}

export interface FinanceAllocationMigrationStatus {
  financeMode: FinanceMode;
  allocationSchemaInstalled: boolean;
  diagnosticsAvailable: boolean;
  diagnosticError: string | null;
  diagnosticResult: FinanceDiagnosticSummary | null;
  blockingIssueCount: number;
  warningCount: number;
  backfillStatus: FinanceBackfillStatus;
  backfillCompletedAt: string | null;
  validationStatus: FinanceValidationStatus;
  invariantsOkAt: string | null;
  activationStatus: FinanceActivationStatus;
  activatedAt: string | null;
  activatedByName: string | null;
  gateUpdatedAt: string | null;
  diagnosticsOkAt: string | null;
  paymentAllocationReadiness: boolean;
  availableCreditReadiness: boolean;
  checkedAt: string | null;
  /** True when the status RPC/table is missing (migrations not applied). */
  statusCheckerAvailable: boolean;
}

export function financeModeLabel(mode: FinanceMode): string {
  return mode === "allocation_enabled" ? "Allocation Enabled" : "Legacy";
}

export function parseFinanceAllocationMigrationStatus(
  raw: unknown,
  options?: { statusCheckerAvailable?: boolean },
): FinanceAllocationMigrationStatus {
  const row =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const diagRaw =
    row.diagnostic_result &&
    typeof row.diagnostic_result === "object" &&
    !Array.isArray(row.diagnostic_result)
      ? (row.diagnostic_result as Record<string, unknown>)
      : null;

  const mode =
    row.finance_mode === "allocation_enabled"
      ? "allocation_enabled"
      : "legacy";

  const backfill =
    row.backfill_status === "completed" ||
    row.backfill_status === "unavailable" ||
    row.backfill_status === "not_started"
      ? row.backfill_status
      : "not_started";

  const validation =
    row.validation_status === "ok" ||
    row.validation_status === "failed" ||
    row.validation_status === "recorded" ||
    row.validation_status === "not_run"
      ? row.validation_status
      : "not_run";

  return {
    financeMode: mode,
    allocationSchemaInstalled: Boolean(row.allocation_schema_installed),
    diagnosticsAvailable: Boolean(row.diagnostics_available),
    diagnosticError:
      typeof row.diagnostic_error === "string" ? row.diagnostic_error : null,
    diagnosticResult: diagRaw
      ? {
          safeToBackfill: Boolean(diagRaw.safe_to_backfill),
          blockingIssueCount: Number(diagRaw.blocking_issue_count ?? 0),
          warningCount: Number(diagRaw.warning_count ?? 0),
          completedPaymentsCount: Number(
            diagRaw.completed_payments_count ?? 0,
          ),
          voidedPaymentsCount: Number(diagRaw.voided_payments_count ?? 0),
          activeChargesCount: Number(diagRaw.active_charges_count ?? 0),
          totalCompletedPayments: Number(
            diagRaw.total_completed_payments ?? 0,
          ),
          totalActiveCharges: Number(diagRaw.total_active_charges ?? 0),
        }
      : null,
    blockingIssueCount: Number(row.blocking_issue_count ?? 0),
    warningCount: Number(row.warning_count ?? 0),
    backfillStatus: backfill,
    backfillCompletedAt:
      typeof row.backfill_completed_at === "string"
        ? row.backfill_completed_at
        : null,
    validationStatus: validation,
    invariantsOkAt:
      typeof row.invariants_ok_at === "string" ? row.invariants_ok_at : null,
    activationStatus:
      row.activation_status === "enabled" ? "enabled" : "legacy",
    activatedAt:
      typeof row.activated_at === "string" ? row.activated_at : null,
    activatedByName:
      typeof row.activated_by_name === "string"
        ? row.activated_by_name
        : null,
    gateUpdatedAt:
      typeof row.gate_updated_at === "string" ? row.gate_updated_at : null,
    diagnosticsOkAt:
      typeof row.diagnostics_ok_at === "string"
        ? row.diagnostics_ok_at
        : null,
    paymentAllocationReadiness: Boolean(row.payment_allocation_readiness),
    availableCreditReadiness: Boolean(row.available_credit_readiness),
    checkedAt: typeof row.checked_at === "string" ? row.checked_at : null,
    statusCheckerAvailable: options?.statusCheckerAvailable ?? true,
  };
}

/** Fallback when the status RPC is not installed yet. */
export function unavailableFinanceAllocationMigrationStatus(): FinanceAllocationMigrationStatus {
  return {
    financeMode: "legacy",
    allocationSchemaInstalled: false,
    diagnosticsAvailable: false,
    diagnosticError: null,
    diagnosticResult: null,
    blockingIssueCount: 0,
    warningCount: 0,
    backfillStatus: "unavailable",
    backfillCompletedAt: null,
    validationStatus: "not_run",
    invariantsOkAt: null,
    activationStatus: "legacy",
    activatedAt: null,
    activatedByName: null,
    gateUpdatedAt: null,
    diagnosticsOkAt: null,
    paymentAllocationReadiness: false,
    availableCreditReadiness: false,
    checkedAt: null,
    statusCheckerAvailable: false,
  };
}
