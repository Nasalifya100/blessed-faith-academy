import { describe, expect, it } from "vitest";

import { canViewFinanceMigrationStatus } from "@/features/auth/permissions";
import {
  financeModeLabel,
  parseFinanceAllocationMigrationStatus,
  unavailableFinanceAllocationMigrationStatus,
} from "@/features/fees/migration-status";

describe("canViewFinanceMigrationStatus", () => {
  it("denies unauthorized users", () => {
    expect(canViewFinanceMigrationStatus("headteacher")).toBe(false);
    expect(canViewFinanceMigrationStatus("bursar")).toBe(false);
    expect(canViewFinanceMigrationStatus("secretary")).toBe(false);
    expect(canViewFinanceMigrationStatus("teacher")).toBe(false);
    expect(canViewFinanceMigrationStatus(null)).toBe(false);
    expect(canViewFinanceMigrationStatus(undefined)).toBe(false);
  });

  it("allows administrators", () => {
    expect(canViewFinanceMigrationStatus("administrator")).toBe(true);
  });
});

describe("financeModeLabel", () => {
  it("displays Legacy mode correctly", () => {
    expect(financeModeLabel("legacy")).toBe("Legacy");
  });

  it("displays Allocation Enabled mode correctly", () => {
    expect(financeModeLabel("allocation_enabled")).toBe("Allocation Enabled");
  });
});

describe("parseFinanceAllocationMigrationStatus", () => {
  it("maps legacy mode and readiness fields", () => {
    const status = parseFinanceAllocationMigrationStatus({
      finance_mode: "legacy",
      allocation_schema_installed: true,
      diagnostics_available: true,
      diagnostic_error: null,
      diagnostic_result: {
        safe_to_backfill: true,
        blocking_issue_count: 0,
        warning_count: 1,
        completed_payments_count: 12,
        voided_payments_count: 0,
        active_charges_count: 40,
        total_completed_payments: 1000,
        total_active_charges: 2500,
      },
      blocking_issue_count: 0,
      warning_count: 1,
      backfill_status: "not_started",
      backfill_completed_at: null,
      validation_status: "not_run",
      invariants_ok_at: null,
      activation_status: "legacy",
      activated_at: null,
      activated_by_name: null,
      gate_updated_at: null,
      diagnostics_ok_at: null,
      payment_allocation_readiness: false,
      available_credit_readiness: false,
      checked_at: "2026-07-19T09:00:00.000Z",
    });

    expect(status.financeMode).toBe("legacy");
    expect(financeModeLabel(status.financeMode)).toBe("Legacy");
    expect(status.activationStatus).toBe("legacy");
    expect(status.availableCreditReadiness).toBe(false);
    expect(status.paymentAllocationReadiness).toBe(false);
    expect(status.blockingIssueCount).toBe(0);
    expect(status.warningCount).toBe(1);
    expect(status.backfillStatus).toBe("not_started");
    expect(status.validationStatus).toBe("not_run");
    expect(status.activatedByName).toBeNull();
  });

  it("maps allocation-enabled mode and activation metadata", () => {
    const status = parseFinanceAllocationMigrationStatus({
      finance_mode: "allocation_enabled",
      allocation_schema_installed: true,
      diagnostics_available: true,
      diagnostic_error: null,
      diagnostic_result: {
        safe_to_backfill: true,
        blocking_issue_count: 0,
        warning_count: 0,
        completed_payments_count: 12,
        voided_payments_count: 0,
        active_charges_count: 40,
        total_completed_payments: 1000,
        total_active_charges: 2500,
      },
      blocking_issue_count: 0,
      warning_count: 0,
      backfill_status: "completed",
      backfill_completed_at: "2026-07-18T10:00:00.000Z",
      validation_status: "ok",
      invariants_ok_at: "2026-07-18T11:00:00.000Z",
      activation_status: "enabled",
      activated_at: "2026-07-18T12:00:00.000Z",
      activated_by_name: "Ada Admin",
      gate_updated_at: "2026-07-18T12:00:00.000Z",
      diagnostics_ok_at: "2026-07-18T09:00:00.000Z",
      payment_allocation_readiness: true,
      available_credit_readiness: true,
      checked_at: "2026-07-19T09:00:00.000Z",
    });

    expect(status.financeMode).toBe("allocation_enabled");
    expect(financeModeLabel(status.financeMode)).toBe("Allocation Enabled");
    expect(status.activationStatus).toBe("enabled");
    expect(status.availableCreditReadiness).toBe(true);
    expect(status.paymentAllocationReadiness).toBe(true);
    expect(status.activatedByName).toBe("Ada Admin");
    expect(status.invariantsOkAt).toBe("2026-07-18T11:00:00.000Z");
    expect(status.activatedAt).toBe("2026-07-18T12:00:00.000Z");
  });

  it("does not surface secret-like fields from raw payloads", () => {
    const status = parseFinanceAllocationMigrationStatus({
      finance_mode: "legacy",
      service_role_key: "secret",
      database_url: "postgres://secret",
      sql: "select * from secrets",
      allocation_schema_installed: false,
    });

    expect(status).not.toHaveProperty("service_role_key");
    expect(status).not.toHaveProperty("database_url");
    expect(status).not.toHaveProperty("sql");
    expect(JSON.stringify(status)).not.toMatch(/secret|postgres:\/\/|select \*/i);
  });
});

describe("unavailableFinanceAllocationMigrationStatus", () => {
  it("reports Legacy when the status checker is not installed", () => {
    const status = unavailableFinanceAllocationMigrationStatus();
    expect(status.financeMode).toBe("legacy");
    expect(financeModeLabel(status.financeMode)).toBe("Legacy");
    expect(status.statusCheckerAvailable).toBe(false);
    expect(status.allocationSchemaInstalled).toBe(false);
    expect(status.availableCreditReadiness).toBe(false);
  });
});
