import type { StaffRole } from "@/features/auth/types";

import { hasFinanceCapability, type FinanceCapability } from "./capabilities";

/** Calendar date in the school's timezone, as YYYY-MM-DD. */
export function lusakaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lusaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function openingBalanceConfigured(account: {
  openingBalanceDate: string | null;
}): boolean {
  return Boolean(account.openingBalanceDate);
}

/**
 * Before a cutover date exists, the account summary includes every assigned
 * receipt and ledger movement. Any of that activity makes the database reject
 * the first opening balance. This does not unlock or rewrite those rows.
 */
export function openingBalanceSetupBlocked(account: {
  openingBalanceDate: string | null;
  assignedReceipts: number;
  ledgerMovement: number;
}): boolean {
  return (
    !openingBalanceConfigured(account) &&
    (account.assignedReceipts !== 0 || account.ledgerMovement !== 0)
  );
}

/**
 * A held-money total is only meaningful once every active account has a
 * cutover date. Otherwise K0 is an unconfigured account, not an empty till.
 */
export function moneyHeldReady(
  accounts: readonly { isActive: boolean; openingBalanceDate: string | null }[],
): boolean {
  const active = accounts.filter((account) => account.isActive);
  return active.length > 0 && active.every(openingBalanceConfigured);
}

/**
 * Contextual sales forms hide the description field. Notes replace it when
 * the bursar wrote something; otherwise the activity supplies a plain label.
 */
export function activityIncomeDescription(notes: string, fallback: string): string {
  const trimmed = notes.trim();
  return trimmed.length >= 3 ? trimmed : fallback;
}

export function suggestedCategoryId(
  categories: readonly {
    id: string;
    code: string;
    isActive: boolean;
    isSalary: boolean;
  }[],
  code: string,
): string {
  return (
    categories.find(
      (category) =>
        category.isActive && !category.isSalary && category.code === code,
    )?.id ?? ""
  );
}

export interface OperationalActivity {
  code: "TUCK_SHOP" | "UNIFORMS" | "MEALS";
  href: string;
  navLabel: string;
  title: string;
  eyebrow: string;
  summary: string;
  incomeButton: string;
  incomeSubmit: string;
  defaultDescription: string;
  expenseButton: string;
  suggestedCategoryCode: string;
  emptyTitle: string;
  emptyDescription: string;
}

export const OPERATIONAL_ACTIVITIES: readonly OperationalActivity[] = [
  {
    code: "UNIFORMS",
    href: "/dashboard/finance/uniforms",
    navLabel: "Uniforms",
    title: "Uniforms",
    eyebrow: "Finance · Uniforms",
    summary:
      "Uniform income and the cost of supplying uniforms. This is not cash in the bank, and it is not a school-fee balance.",
    incomeButton: "Record Uniform Income",
    incomeSubmit: "Record Uniform Income",
    defaultDescription: "Uniform income",
    expenseButton: "Record Expense",
    suggestedCategoryCode: "UNIFORM_PURCHASES",
    emptyTitle: "No Uniform transactions yet.",
    emptyDescription: "Record the first uniform sale or supplier cost from this page.",
  },
  {
    code: "MEALS",
    href: "/dashboard/finance/meals",
    navLabel: "Meals",
    title: "Meals",
    eyebrow: "Finance · Meals",
    summary:
      "Meal income and food costs. Recording a meal here does not change a family's mandatory school-fee balance.",
    incomeButton: "Record Meal Income",
    incomeSubmit: "Record Meal Income",
    defaultDescription: "Meal income",
    expenseButton: "Record Expense",
    suggestedCategoryCode: "FOOD_CATERING",
    emptyTitle: "No Meals transactions yet.",
    emptyDescription: "Record meal income or a food cost from this page.",
  },
  {
    code: "TUCK_SHOP",
    href: "/dashboard/finance/tuck-shop",
    navLabel: "Tuck Shop",
    title: "Tuck Shop",
    eyebrow: "Finance · Tuck Shop",
    summary:
      "Daily tuck shop sales and tuck shop costs. The sale is Tuck Shop income. The place the cash is kept — bank, mobile money, or petty cash — is chosen separately.",
    incomeButton: "Record Sales",
    incomeSubmit: "Record Sales",
    defaultDescription: "Tuck shop sales",
    expenseButton: "Record Expense",
    suggestedCategoryCode: "TUCK_SHOP_STOCK",
    emptyTitle: "No Tuck Shop activity yet.",
    emptyDescription: "Record the first day's sales from this page. You do not need to choose Tuck Shop again.",
  },
];

export function operationalActivity(
  code: string,
): OperationalActivity | undefined {
  return OPERATIONAL_ACTIVITIES.find(
    (activity) => activity.code === code.toUpperCase(),
  );
}

/** Where a fund name in a report should send the reader. */
export const CONTEXTUAL_ACTIVITY_CODES = ["UNIFORMS", "MEALS", "TUCK_SHOP"] as const;

export type ContextualActivityCode = (typeof CONTEXTUAL_ACTIVITY_CODES)[number];

export const ACTIVITY_RECENT_LIMIT = 40;

export function isContextualActivityCode(
  code: string,
): code is ContextualActivityCode {
  return (CONTEXTUAL_ACTIVITY_CODES as readonly string[]).includes(code);
}

/**
 * Resolves the fund for a contextual page from school-scoped rows.
 * A browser-supplied fund id is not an input: zero or several matches fail.
 */
export function contextualFundId(
  funds: readonly {
    id: string;
    code: string;
    isActive: boolean;
    isSchoolFees: boolean;
  }[],
  activityCode: string,
): string | null {
  if (!isContextualActivityCode(activityCode)) return null;
  const matches = funds.filter(
    (fund) =>
      fund.code === activityCode && fund.isActive && !fund.isSchoolFees,
  );
  return matches.length === 1 ? matches[0].id : null;
}

/** The petty-cash account a top-up or petty-cash expense may use. */
export function primaryPettyCashAccount<T extends {
  id: string;
  accountType: string;
  isActive: boolean;
  sortOrder: number;
}>(accounts: readonly T[]): T | null {
  const matches = accounts
    .filter((account) => account.accountType === "petty_cash" && account.isActive)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  return matches[0] ?? null;
}

export function activityEmptyDescription(
  activity: OperationalActivity,
  canRecord: boolean,
): string {
  if (!canRecord) {
    return `${activity.title} has no recorded activity yet.`;
  }
  return activity.emptyDescription;
}

export function transactionStatusLabel(entry: {
  entryType: string;
  isReversal: boolean;
  reversedAt: string | null;
}): string {
  const base =
    entry.entryType === "income"
      ? "Income"
      : entry.entryType === "expense"
        ? "Expense"
        : entry.entryType === "transfer_in"
          ? "Transfer in"
          : entry.entryType === "transfer_out"
            ? "Transfer out"
            : "Adjustment";
  if (entry.isReversal) return `Reversal · ${base}`;
  if (entry.reversedAt) return `Reversed · ${base}`;
  return base;
}

export function activityHref(code: string): string {
  const activity = operationalActivity(code);
  if (activity) return activity.href;
  if (code.toUpperCase() === "SCHOOL_FEES") return "/dashboard/fees";
  return `/dashboard/finance/funds/${code.toLowerCase()}`;
}

export interface FinanceNavItem {
  href: string;
  label: string;
  capability: FinanceCapability;
}

/**
 * Day-to-day activities first. Account infrastructure and the full fund
 * list stay at the end. This is a flat bar because the dashboard nav is flat.
 */
export function financeNavItems(
  role: StaffRole | null | undefined,
): FinanceNavItem[] {
  const items: FinanceNavItem[] = [
    { href: "/dashboard/finance", label: "Overview", capability: "FINANCE_VIEW" },
    { href: "/dashboard/fees", label: "School Fees", capability: "FINANCE_VIEW" },
    ...OPERATIONAL_ACTIVITIES.map((activity) => ({
      href: activity.href,
      label: activity.navLabel,
      capability: "FINANCE_FUNDS_VIEW" as const,
    })),
    {
      href: "/dashboard/finance/expenses",
      label: "Expenses",
      capability: "FINANCE_EXPENSE_RECORD",
    },
    {
      href: "/dashboard/finance/salaries",
      label: "Salaries",
      capability: "FINANCE_SALARY_VIEW",
    },
    {
      href: "/dashboard/finance/accounts",
      label: "Money held",
      capability: "FINANCE_ACCOUNTS_VIEW",
    },
    {
      href: "/dashboard/finance/petty-cash",
      label: "Petty Cash",
      capability: "FINANCE_ACCOUNTS_VIEW",
    },
    {
      href: "/dashboard/finance/transfers",
      label: "Transfers",
      capability: "FINANCE_ACCOUNTS_VIEW",
    },
    {
      href: "/dashboard/finance/reports",
      label: "Reports",
      capability: "FINANCE_REPORTS_VIEW",
    },
    {
      href: "/dashboard/finance/funds",
      label: "Funds",
      capability: "FINANCE_FUNDS_VIEW",
    },
  ];

  return items.filter((item) => hasFinanceCapability(role, item.capability));
}
