import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FINANCE_CAPABILITIES,
  canOpenFinance,
  canViewSalaries,
  financeCapabilitiesFor,
  hasFinanceCapability,
  type FinanceCapability,
} from "./capabilities";
import type { StaffRole } from "@/features/auth/types";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260929120000_finance_funds_accounts_capabilities.sql",
);

/**
 * The database is the authority for finance permissions. These tests keep the
 * TypeScript mirror honest by reading the capability lists straight out of the
 * migration, so the two can never quietly diverge.
 */
function sqlCapabilitiesFor(role: string): Set<string> {
  const sql = readFileSync(MIGRATION, "utf8");
  const marker = `if v_role = '${role}'::public.staff_role then`;
  const start = sql.indexOf(marker);
  expect(start, `no capability block found for ${role}`).toBeGreaterThan(-1);
  const blockEnd = sql.indexOf("end if;", start);
  const block = sql.slice(start, blockEnd);
  return new Set(
    [...block.matchAll(/'(FINANCE_[A-Z_]+)'/g)].map((match) => match[1]),
  );
}

describe("SQL and TypeScript capability matrices agree", () => {
  for (const role of ["headteacher", "bursar", "secretary"] as const) {
    it(`${role} matches has_finance_capability`, () => {
      const fromSql = sqlCapabilitiesFor(role);
      const fromCode = new Set(financeCapabilitiesFor(role));
      expect([...fromCode].sort()).toEqual([...fromSql].sort());
    });
  }

  it("every capability the code knows about is referenced in SQL", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const capability of FINANCE_CAPABILITIES) {
      expect(sql, `${capability} missing from migration`).toContain(
        `'${capability}'`,
      );
    }
  });
});

describe("administrator", () => {
  it("has every capability", () => {
    expect(financeCapabilitiesFor("administrator")).toEqual([
      ...FINANCE_CAPABILITIES,
    ]);
  });
});

describe("FIN-17: salary visibility is tightly held", () => {
  const salaryCapabilities: FinanceCapability[] = [
    "FINANCE_SALARY_VIEW",
    "FINANCE_SALARY_RECORD",
    "FINANCE_SALARY_APPROVE",
    "FINANCE_SALARY_PAY",
  ];

  it("teachers have no finance access at all", () => {
    expect(canOpenFinance("teacher")).toBe(false);
    expect(financeCapabilitiesFor("teacher")).toEqual([]);
  });

  it("teachers cannot see salaries", () => {
    for (const capability of salaryCapabilities) {
      expect(hasFinanceCapability("teacher", capability)).toBe(false);
    }
    expect(canViewSalaries("teacher")).toBe(false);
  });

  it("secretaries cannot see salaries", () => {
    for (const capability of salaryCapabilities) {
      expect(hasFinanceCapability("secretary", capability)).toBe(false);
    }
    expect(canViewSalaries("secretary")).toBe(false);
  });

  it("only administrator, headteacher, and bursar can see salaries", () => {
    const roles: StaffRole[] = [
      "administrator",
      "headteacher",
      "bursar",
      "secretary",
      "teacher",
    ];
    expect(roles.filter((role) => canViewSalaries(role))).toEqual([
      "administrator",
      "headteacher",
      "bursar",
    ]);
  });
});

describe("separation of duties", () => {
  it("a bursar cannot approve the salaries they prepare and pay", () => {
    expect(hasFinanceCapability("bursar", "FINANCE_SALARY_RECORD")).toBe(true);
    expect(hasFinanceCapability("bursar", "FINANCE_SALARY_PAY")).toBe(true);
    expect(hasFinanceCapability("bursar", "FINANCE_SALARY_APPROVE")).toBe(false);
  });

  it("a bursar cannot reconfigure funds or accounts", () => {
    expect(hasFinanceCapability("bursar", "FINANCE_SETUP_MANAGE")).toBe(false);
  });
});

describe("secretary is read-only", () => {
  it("cannot move money in any way", () => {
    const writeCapabilities: FinanceCapability[] = [
      "FINANCE_LEDGER_RECORD",
      "FINANCE_EXPENSE_RECORD",
      "FINANCE_EXPENSE_APPROVE",
      "FINANCE_EXPENSE_PAY",
      "FINANCE_TRANSFER_RECORD",
      "FINANCE_REVERSE",
      "FINANCE_PETTY_CASH_RECORD",
      "FINANCE_SETUP_MANAGE",
    ];
    for (const capability of writeCapabilities) {
      expect(hasFinanceCapability("secretary", capability)).toBe(false);
    }
  });

  it("cannot see physical account balances", () => {
    expect(hasFinanceCapability("secretary", "FINANCE_ACCOUNTS_VIEW")).toBe(
      false,
    );
  });
});

describe("role normalisation", () => {
  it("tolerates casing and whitespace", () => {
    expect(canOpenFinance(" Administrator " as StaffRole)).toBe(true);
    expect(canOpenFinance("BURSAR" as StaffRole)).toBe(true);
  });

  it("rejects unknown and missing roles", () => {
    expect(canOpenFinance(null)).toBe(false);
    expect(canOpenFinance(undefined)).toBe(false);
    expect(canOpenFinance("accountant" as StaffRole)).toBe(false);
  });
});
