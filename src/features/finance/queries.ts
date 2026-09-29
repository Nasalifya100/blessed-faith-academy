import { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  ExpenseCategory,
  ExpenseRow,
  ExpenseStatus,
  FinanceOverview,
  FinancialAccount,
  FinanceFund,
  FundPosition,
  LedgerEntry,
  SalaryRow,
  StudentFinanceBreakdown,
  TransferRow,
} from "./types";

/** Every list query is bounded so a long-running school cannot stall a page. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function mapFundPosition(raw: Record<string, unknown>): FundPosition {
  return {
    id: String(raw.id),
    code: String(raw.code),
    name: String(raw.name),
    description: (raw.description as string | null) ?? null,
    isSchoolFees: Boolean(raw.is_school_fees),
    isActive: Boolean(raw.is_active),
    sortOrder: num(raw.sort_order),
    studentIncome: num(raw.student_income),
    otherIncome: num(raw.other_income),
    totalIncome: num(raw.total_income),
    totalExpenditure: num(raw.total_expenditure),
    netPosition: num(raw.net_position),
    salaryCostsOmitted: Boolean(raw.salary_costs_omitted),
    allocationsActive: Boolean(raw.allocations_active),
  };
}

function mapAccount(raw: Record<string, unknown>): FinancialAccount {
  return {
    id: String(raw.id),
    code: String(raw.code),
    name: String(raw.name),
    accountType: raw.account_type as FinancialAccount["accountType"],
    description: (raw.description as string | null) ?? null,
    maskedReference: (raw.masked_reference as string | null) ?? null,
    openingBalance: num(raw.opening_balance),
    openingBalanceDate: (raw.opening_balance_date as string | null) ?? null,
    defaultForMethod: (raw.default_for_method as string | null) ?? null,
    isActive: Boolean(raw.is_active),
    sortOrder: num(raw.sort_order),
    currentBalance: num(raw.current_balance),
    ledgerMovement: num(raw.ledger_movement),
    assignedReceipts: num(raw.assigned_receipts),
  };
}

/**
 * The single read used by the Finance overview. All figures are computed in
 * the database from authoritative records; nothing is summed in the browser.
 */
export async function getFinanceOverview(
  from?: string | null,
  to?: string | null,
): Promise<FinanceOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_finance_overview", {
    p_from: from || null,
    p_to: to || null,
  });

  if (error || !data) return null;

  const payload = data as Record<string, unknown>;
  const fundsPayload = (payload.funds ?? null) as Record<string, unknown> | null;
  const accountsPayload = (payload.accounts ?? null) as Record<
    string,
    unknown
  > | null;

  const funds = Array.isArray(fundsPayload?.funds)
    ? (fundsPayload.funds as Record<string, unknown>[]).map(mapFundPosition)
    : [];
  const accounts = Array.isArray(accountsPayload?.accounts)
    ? (accountsPayload.accounts as Record<string, unknown>[]).map(mapAccount)
    : [];

  const pending = (payload.pending_expenses ?? {}) as Record<string, unknown>;

  return {
    from: (payload.from as string | null) ?? null,
    to: (payload.to as string | null) ?? null,
    funds,
    accounts,
    totalIncome: num(fundsPayload?.total_income),
    totalExpenditure: num(fundsPayload?.total_expenditure),
    totalHeld: num(accountsPayload?.total_held),
    outstandingSchoolFees: num(payload.outstanding_school_fees),
    pendingExpenses: {
      count: num(pending.count),
      amount: num(pending.amount),
    },
    transfersTotal: num(payload.transfers_total),
    canViewSalaries: Boolean(payload.can_view_salaries),
  };
}

export async function getFundPositions(
  from?: string | null,
  to?: string | null,
): Promise<FundPosition[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_finance_fund_positions", {
    p_from: from || null,
    p_to: to || null,
  });
  if (error || !data) return [];
  const payload = data as Record<string, unknown>;
  return Array.isArray(payload.funds)
    ? (payload.funds as Record<string, unknown>[]).map(mapFundPosition)
    : [];
}

export interface FinancialAccountSummary {
  accounts: FinancialAccount[];
  unassignedReceipts: { count: number; amount: number };
}

export async function getFinancialAccountSummary(): Promise<FinancialAccountSummary> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_financial_accounts_summary");
  if (error || !data) {
    return { accounts: [], unassignedReceipts: { count: 0, amount: 0 } };
  }
  const payload = data as Record<string, unknown>;
  const unassigned = (payload.unassigned_receipts ?? {}) as Record<string, unknown>;
  return {
    accounts: Array.isArray(payload.accounts)
      ? (payload.accounts as Record<string, unknown>[]).map(mapAccount)
      : [],
    unassignedReceipts: {
      count: num(unassigned.count),
      amount: num(unassigned.amount),
    },
  };
}

export async function getFinancialAccounts(): Promise<FinancialAccount[]> {
  const summary = await getFinancialAccountSummary();
  return summary.accounts;
}

export async function getFunds(): Promise<FinanceFund[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_funds")
    .select("id, code, name, description, is_school_fees, is_active, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    isSchoolFees: Boolean(row.is_school_fees),
    isActive: Boolean(row.is_active),
    sortOrder: num(row.sort_order),
  }));
}

export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, code, name, default_fund_id, is_salary, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    defaultFundId: (row.default_fund_id as string | null) ?? null,
    isSalary: Boolean(row.is_salary),
    isActive: Boolean(row.is_active),
    sortOrder: num(row.sort_order),
  }));
}

interface LedgerFilters {
  fundId?: string | null;
  accountId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export async function getLedgerEntries(
  filters: LedgerFilters = {},
): Promise<LedgerEntry[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("finance_ledger_entries")
    .select(
      `id, entry_date, entry_type, direction, amount, fund_id, account_id,
       description, reference, payee, source_type, source_id, is_reversal,
       reversed_at, reversal_reason, account_delta, income_effect,
       expense_effect,
       fund:finance_funds(name),
       account:financial_accounts(name)`,
    )
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(clampLimit(filters.limit));

  if (filters.fundId) query = query.eq("fund_id", filters.fundId);
  if (filters.accountId) query = query.eq("account_id", filters.accountId);
  if (filters.from) query = query.gte("entry_date", filters.from);
  if (filters.to) query = query.lte("entry_date", filters.to);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => {
    const record = row as Record<string, unknown>;
    const fund = record.fund as { name: string } | null;
    const account = record.account as { name: string } | null;
    return {
      id: String(record.id),
      entryDate: String(record.entry_date),
      entryType: record.entry_type as LedgerEntry["entryType"],
      direction: record.direction as LedgerEntry["direction"],
      amount: num(record.amount),
      fundId: (record.fund_id as string | null) ?? null,
      fundName: fund?.name ?? null,
      accountId: String(record.account_id),
      accountName: account?.name ?? null,
      description: String(record.description),
      reference: (record.reference as string | null) ?? null,
      payee: (record.payee as string | null) ?? null,
      sourceType: record.source_type as LedgerEntry["sourceType"],
      sourceId: (record.source_id as string | null) ?? null,
      isReversal: Boolean(record.is_reversal),
      reversedAt: (record.reversed_at as string | null) ?? null,
      reversalReason: (record.reversal_reason as string | null) ?? null,
      accountDelta: num(record.account_delta),
      incomeEffect: num(record.income_effect),
      expenseEffect: num(record.expense_effect),
    };
  });
}

export async function getExpenses(
  filters: {
    status?: ExpenseStatus | null;
    fundId?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
  } = {},
): Promise<ExpenseRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("expenses")
    .select(
      `id, expense_date, amount, category_id, fund_id, account_id, description,
       payee, reference, status, recorded_at, recorded_by, approved_at, approved_by, paid_at,
       reversal_reason,
       category:expense_categories(name),
       fund:finance_funds(name),
       account:financial_accounts(name)`,
    )
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(clampLimit(filters.limit));

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.fundId) query = query.eq("fund_id", filters.fundId);
  if (filters.from) query = query.gte("expense_date", filters.from);
  if (filters.to) query = query.lte("expense_date", filters.to);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      expenseDate: String(record.expense_date),
      amount: num(record.amount),
      categoryId: String(record.category_id),
      categoryName: (record.category as { name: string } | null)?.name ?? null,
      fundId: String(record.fund_id),
      fundName: (record.fund as { name: string } | null)?.name ?? null,
      accountId: String(record.account_id),
      accountName: (record.account as { name: string } | null)?.name ?? null,
      description: String(record.description),
      payee: (record.payee as string | null) ?? null,
      reference: (record.reference as string | null) ?? null,
      status: record.status as ExpenseStatus,
      recordedAt: String(record.recorded_at),
      approvedAt: (record.approved_at as string | null) ?? null,
      paidAt: (record.paid_at as string | null) ?? null,
      reversalReason: (record.reversal_reason as string | null) ?? null,
      selfApproved: Boolean(
        record.recorded_by &&
          record.approved_by &&
          record.recorded_by === record.approved_by,
      ),
    };
  });
}

export async function getTransfers(limit = DEFAULT_LIMIT): Promise<TransferRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_transfers")
    .select(
      `id, transfer_date, amount, from_account_id, to_account_id, description,
       reference, reversed_at, reversal_reason,
       from_account:financial_accounts!finance_transfers_from_account_id_fkey(name),
       to_account:financial_accounts!finance_transfers_to_account_id_fkey(name)`,
    )
    .order("transfer_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(clampLimit(limit));

  if (error || !data) return [];

  return data.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      transferDate: String(record.transfer_date),
      amount: num(record.amount),
      fromAccountId: String(record.from_account_id),
      fromAccountName:
        (record.from_account as { name: string } | null)?.name ?? null,
      toAccountId: String(record.to_account_id),
      toAccountName:
        (record.to_account as { name: string } | null)?.name ?? null,
      description: String(record.description),
      reference: (record.reference as string | null) ?? null,
      reversedAt: (record.reversed_at as string | null) ?? null,
      reversalReason: (record.reversal_reason as string | null) ?? null,
    };
  });
}

/**
 * Salary rows. RLS withholds this table entirely from anyone without
 * FINANCE_SALARY_VIEW, so an unauthorised caller simply receives nothing.
 */
export async function getSalaryPayments(
  limit = DEFAULT_LIMIT,
): Promise<SalaryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("salary_payments")
    .select(
      `id, staff_id, period_start, period_end, period_label, gross_amount,
       deductions_amount, net_amount, status, payment_date, account_id,
       reference, reversal_reason,
       staff:profiles!salary_payments_staff_id_fkey(full_name),
       account:financial_accounts(name)`,
    )
    .order("period_start", { ascending: false })
    .limit(clampLimit(limit));

  if (error || !data) return [];

  return data.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      staffId: String(record.staff_id),
      staffName:
        (record.staff as { full_name: string } | null)?.full_name ?? null,
      periodStart: String(record.period_start),
      periodEnd: String(record.period_end),
      periodLabel: String(record.period_label),
      grossAmount: num(record.gross_amount),
      deductionsAmount: num(record.deductions_amount),
      netAmount: num(record.net_amount),
      status: record.status as SalaryRow["status"],
      paymentDate: (record.payment_date as string | null) ?? null,
      accountId: (record.account_id as string | null) ?? null,
      accountName: (record.account as { name: string } | null)?.name ?? null,
      reference: (record.reference as string | null) ?? null,
      reversalReason: (record.reversal_reason as string | null) ?? null,
    };
  });
}

/** Active staff, for choosing who a salary record belongs to. */
export async function getStaffOptions(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(MAX_LIMIT);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    name: (row.full_name as string | null) ?? "Unnamed staff member",
  }));
}

/**
 * Mandatory school fees separated from optional purchases.
 * Additive to getStudentFeeStatement, which keeps its existing meaning.
 */
export async function getStudentFinanceBreakdown(
  studentId: string,
): Promise<StudentFinanceBreakdown | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "get_student_finance_breakdown",
    { p_student_id: studentId },
  );

  if (error || !data) return null;
  const payload = data as Record<string, unknown>;
  const fees = (payload.school_fees ?? {}) as Record<string, unknown>;
  const totals = (payload.additional_totals ?? {}) as Record<string, unknown>;
  const additional = Array.isArray(payload.additional)
    ? (payload.additional as Record<string, unknown>[])
    : [];

  return {
    studentId: String(payload.student_id),
    basis: payload.basis === "allocations" ? "allocations" : "fifo_estimate",
    schoolFees: {
      charged: num(fees.charged),
      paid: num(fees.paid),
      outstanding: num(fees.outstanding),
    },
    additional: additional.map((entry) => ({
      code: String(entry.code),
      name: String(entry.name),
      charged: num(entry.charged),
      paid: num(entry.paid),
      outstanding: num(entry.outstanding),
    })),
    additionalTotals: {
      charged: num(totals.charged),
      paid: num(totals.paid),
      outstanding: num(totals.outstanding),
    },
  };
}
