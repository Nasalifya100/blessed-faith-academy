export type FinancialAccountType = "bank" | "mobile_money" | "petty_cash";

export type FinanceEntryType =
  | "income"
  | "expense"
  | "transfer_in"
  | "transfer_out"
  | "adjustment";

export type FinanceDirection = "in" | "out";

export type FinanceSourceType =
  | "manual"
  | "expense"
  | "salary"
  | "transfer"
  | "adjustment";

export type ExpenseStatus = "recorded" | "approved" | "paid" | "reversed";

export type SalaryPaymentStatus = "draft" | "approved" | "paid" | "reversed";

export type DisbursementMethod =
  | "cash"
  | "mobile_money"
  | "bank_transfer"
  | "cheque";

export interface FinanceFund {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSchoolFees: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface FundPosition extends FinanceFund {
  studentIncome: number;
  otherIncome: number;
  totalIncome: number;
  totalExpenditure: number;
  netPosition: number;
  /** True when salary costs were left out of this fund's expenditure. */
  salaryCostsOmitted: boolean;
  /** False until payment allocations are switched on for the school. */
  allocationsActive: boolean;
}

export interface FinancialAccount {
  id: string;
  code: string;
  name: string;
  accountType: FinancialAccountType;
  description: string | null;
  maskedReference: string | null;
  openingBalance: number;
  openingBalanceDate: string | null;
  defaultForMethod: string | null;
  isActive: boolean;
  sortOrder: number;
  currentBalance: number;
  /** Ledger movement dated after the opening balance. */
  ledgerMovement: number;
  /** Receipts that name this account and fall after the opening balance. */
  assignedReceipts: number;
}

export interface LedgerEntry {
  id: string;
  entryDate: string;
  entryType: FinanceEntryType;
  direction: FinanceDirection;
  amount: number;
  fundId: string | null;
  fundName: string | null;
  accountId: string;
  accountName: string | null;
  description: string;
  reference: string | null;
  payee: string | null;
  sourceType: FinanceSourceType;
  sourceId: string | null;
  isReversal: boolean;
  reversedAt: string | null;
  reversalReason: string | null;
  accountDelta: number;
  incomeEffect: number;
  expenseEffect: number;
}

export interface ExpenseRow {
  id: string;
  expenseDate: string;
  amount: number;
  categoryId: string;
  categoryName: string | null;
  fundId: string;
  fundName: string | null;
  accountId: string;
  accountName: string | null;
  description: string;
  payee: string | null;
  reference: string | null;
  status: ExpenseStatus;
  recordedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  reversalReason: string | null;
  /** The person who recorded the expense also approved it. */
  selfApproved: boolean;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  defaultFundId: string | null;
  isSalary: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface TransferRow {
  id: string;
  transferDate: string;
  amount: number;
  fromAccountId: string;
  fromAccountName: string | null;
  toAccountId: string;
  toAccountName: string | null;
  description: string;
  reference: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface SalaryRow {
  id: string;
  staffId: string;
  staffName: string | null;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  grossAmount: number;
  deductionsAmount: number;
  netAmount: number;
  status: SalaryPaymentStatus;
  paymentDate: string | null;
  accountId: string | null;
  accountName: string | null;
  reference: string | null;
  reversalReason: string | null;
}

export interface StudentFinanceBreakdown {
  studentId: string;
  /** "allocations" when the FIFO engine is live, "fifo_estimate" otherwise. */
  basis: "allocations" | "fifo_estimate";
  schoolFees: { charged: number; paid: number; outstanding: number };
  additional: {
    code: string;
    name: string;
    charged: number;
    paid: number;
    outstanding: number;
  }[];
  additionalTotals: { charged: number; paid: number; outstanding: number };
}

export interface FinanceOverview {
  from: string | null;
  to: string | null;
  funds: FundPosition[];
  accounts: FinancialAccount[];
  totalIncome: number;
  totalExpenditure: number;
  totalHeld: number;
  outstandingSchoolFees: number;
  pendingExpenses: { count: number; amount: number };
  transfersTotal: number;
  canViewSalaries: boolean;
}
