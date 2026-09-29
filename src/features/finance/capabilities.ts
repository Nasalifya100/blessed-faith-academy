import type { StaffRole } from "@/features/auth/types";
import { normalizeStaffRole } from "@/features/auth/permissions";

/**
 * Finance capabilities.
 *
 * This list mirrors public.has_finance_capability() exactly. The database is
 * the authority; this copy exists only so the UI can hide what the caller
 * cannot do. Never rely on it as a security control — every action re-checks
 * in SQL. The mirror is kept honest by capabilities.test.ts, which parses the
 * migration and compares the two matrices.
 */
export const FINANCE_CAPABILITIES = [
  "FINANCE_VIEW",
  "FINANCE_FUNDS_VIEW",
  "FINANCE_ACCOUNTS_VIEW",
  "FINANCE_REPORTS_VIEW",
  "FINANCE_LEDGER_RECORD",
  "FINANCE_EXPENSE_RECORD",
  "FINANCE_EXPENSE_APPROVE",
  "FINANCE_EXPENSE_PAY",
  "FINANCE_TRANSFER_RECORD",
  "FINANCE_REVERSE",
  "FINANCE_PETTY_CASH_RECORD",
  "FINANCE_SALARY_VIEW",
  "FINANCE_SALARY_RECORD",
  "FINANCE_SALARY_APPROVE",
  "FINANCE_SALARY_PAY",
  "FINANCE_SETUP_MANAGE",
] as const;

export type FinanceCapability = (typeof FINANCE_CAPABILITIES)[number];

const HEADTEACHER_CAPABILITIES: readonly FinanceCapability[] = [
  "FINANCE_VIEW",
  "FINANCE_FUNDS_VIEW",
  "FINANCE_ACCOUNTS_VIEW",
  "FINANCE_REPORTS_VIEW",
  "FINANCE_LEDGER_RECORD",
  "FINANCE_EXPENSE_RECORD",
  "FINANCE_EXPENSE_APPROVE",
  "FINANCE_EXPENSE_PAY",
  "FINANCE_TRANSFER_RECORD",
  "FINANCE_REVERSE",
  "FINANCE_PETTY_CASH_RECORD",
  "FINANCE_SALARY_VIEW",
  "FINANCE_SALARY_RECORD",
  "FINANCE_SALARY_APPROVE",
  "FINANCE_SALARY_PAY",
  "FINANCE_SETUP_MANAGE",
] as const;

/**
 * The bursar runs finance day to day but cannot approve salaries they
 * themselves prepare and pay, and cannot reconfigure funds or accounts.
 */
const BURSAR_CAPABILITIES: readonly FinanceCapability[] = [
  "FINANCE_VIEW",
  "FINANCE_FUNDS_VIEW",
  "FINANCE_ACCOUNTS_VIEW",
  "FINANCE_REPORTS_VIEW",
  "FINANCE_LEDGER_RECORD",
  "FINANCE_EXPENSE_RECORD",
  "FINANCE_EXPENSE_PAY",
  "FINANCE_TRANSFER_RECORD",
  "FINANCE_REVERSE",
  "FINANCE_PETTY_CASH_RECORD",
  "FINANCE_SALARY_VIEW",
  "FINANCE_SALARY_RECORD",
  "FINANCE_SALARY_PAY",
] as const;

/** Operational visibility only. Never salary, never money movement. */
const SECRETARY_CAPABILITIES: readonly FinanceCapability[] = [
  "FINANCE_VIEW",
  "FINANCE_FUNDS_VIEW",
] as const;

export function hasFinanceCapability(
  role: StaffRole | null | undefined,
  capability: FinanceCapability,
): boolean {
  const normalized = normalizeStaffRole(role);
  if (!normalized) return false;

  switch (normalized) {
    case "administrator":
      return true;
    case "headteacher":
      return HEADTEACHER_CAPABILITIES.includes(capability);
    case "bursar":
      return BURSAR_CAPABILITIES.includes(capability);
    case "secretary":
      return SECRETARY_CAPABILITIES.includes(capability);
    case "teacher":
      return false;
    default:
      return false;
  }
}

export function financeCapabilitiesFor(
  role: StaffRole | null | undefined,
): FinanceCapability[] {
  return FINANCE_CAPABILITIES.filter((capability) =>
    hasFinanceCapability(role, capability),
  );
}

/** Convenience gate for the Finance area in navigation and route guards. */
export function canOpenFinance(role: StaffRole | null | undefined): boolean {
  return hasFinanceCapability(role, "FINANCE_VIEW");
}

/** Salary data is the most sensitive figure in the system. */
export function canViewSalaries(role: StaffRole | null | undefined): boolean {
  return hasFinanceCapability(role, "FINANCE_SALARY_VIEW");
}
