"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { hasFinanceCapability, type FinanceCapability } from "./capabilities";
import {
  contextualFundId,
  primaryPettyCashAccount,
} from "./presentation";
import {
  approveExpenseSchema,
  approveSalarySchema,
  payExpenseSchema,
  paySalarySchema,
  addPettyCashSchema,
  recordActivityExpenseSchema,
  recordActivityIncomeSchema,
  recordExpenseSchema,
  recordFundIncomeSchema,
  recordPettyCashExpenseSchema,
  recordSalarySchema,
  recordTransferSchema,
  reverseExpenseSchema,
  reverseLedgerEntrySchema,
  reverseSalarySchema,
  reverseTransferSchema,
  upsertAccountSchema,
  upsertFundSchema,
} from "./schemas";

export interface ActionResult {
  error: string | null;
}

const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";
const INVALID_INPUT = "Please check the form and try again.";

/**
 * UI-side gate. The database re-checks the same capability inside every RPC,
 * so this only short-circuits an obviously unauthorised request.
 */
async function assertCapability(
  capability: FinanceCapability,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: SESSION_ERROR };
  if (current.profileLoadFailed) return { ok: false, error: CONNECTION_ERROR };
  if (!current.profile?.is_active) {
    return { ok: false, error: "Your account is not active." };
  }
  if (!hasFinanceCapability(current.profile.role, capability)) {
    return {
      ok: false,
      error: "You are not authorized to perform this financial action.",
    };
  }
  return { ok: true };
}

function revalidateFinance(extraPaths: string[] = []): void {
  revalidatePath("/dashboard/finance");
  for (const path of extraPaths) {
    revalidatePath(path);
  }
}

function emptyToNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function recordFundIncomeAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_LEDGER_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordFundIncomeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_fund_income", {
    p_fund_id: parsed.data.fundId,
    p_account_id: parsed.data.accountId,
    p_amount: parsed.data.amount,
    p_received_on: parsed.data.receivedOn,
    p_description: parsed.data.description,
    p_reference: emptyToNull(parsed.data.reference),
    p_payer: emptyToNull(parsed.data.payer),
    p_student_id: null,
    p_client_request_id: parsed.data.clientRequestId,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/funds",
    "/dashboard/finance/accounts",
    "/dashboard/finance/tuck-shop",
    "/dashboard/finance/uniforms",
    "/dashboard/finance/meals",
  ]);
  return { error: null };
}

async function resolveActivityFundId(
  activityCode: string,
): Promise<{ fundId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_funds")
    .select("id, code, is_school_fees, is_active")
    .eq("code", activityCode);
  if (error) return { error: error.message };
  const fundId = contextualFundId(
    (data ?? []).map((row) => ({
      id: String(row.id),
      code: String(row.code),
      isActive: Boolean(row.is_active),
      isSchoolFees: Boolean(row.is_school_fees),
    })),
    activityCode,
  );
  if (!fundId) {
    return { error: "That activity is not available for recording." };
  }
  return { fundId };
}

async function resolvePettyCashAccountId(): Promise<
  { accountId: string } | { error: string }
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, account_type, is_active, sort_order");
  if (error) return { error: error.message };
  const account = primaryPettyCashAccount(
    (data ?? []).map((row) => ({
      id: String(row.id),
      accountType: String(row.account_type),
      isActive: Boolean(row.is_active),
      sortOrder: Number(row.sort_order ?? 0),
    })),
  );
  if (!account) {
    return { error: "No active petty cash account is available." };
  }
  return { accountId: account.id };
}

export async function recordActivityIncomeAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_LEDGER_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordActivityIncomeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const fund = await resolveActivityFundId(parsed.data.activityCode);
  if ("error" in fund) return { error: fund.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_fund_income", {
    p_fund_id: fund.fundId,
    p_account_id: parsed.data.accountId,
    p_amount: parsed.data.amount,
    p_received_on: parsed.data.receivedOn,
    p_description: parsed.data.description,
    p_reference: emptyToNull(parsed.data.reference),
    p_payer: emptyToNull(parsed.data.payer),
    p_student_id: null,
    p_client_request_id: parsed.data.clientRequestId,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/funds",
    "/dashboard/finance/accounts",
    "/dashboard/finance/tuck-shop",
    "/dashboard/finance/uniforms",
    "/dashboard/finance/meals",
  ]);
  return { error: null };
}

export async function reverseFundIncomeAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_REVERSE");
  if (!auth.ok) return { error: auth.error };

  const parsed = reverseLedgerEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reverse_fund_income", {
    p_entry_id: parsed.data.entryId,
    p_reason: parsed.data.reason,
  });

  if (error) return { error: error.message };
  revalidateFinance(["/dashboard/finance/funds", "/dashboard/finance/accounts"]);
  return { error: null };
}

export async function recordExpenseAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_EXPENSE_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_expense", {
    p_category_id: parsed.data.categoryId,
    p_fund_id: parsed.data.fundId,
    p_account_id: parsed.data.accountId,
    p_amount: parsed.data.amount,
    p_expense_date: parsed.data.expenseDate,
    p_description: parsed.data.description,
    p_payee: emptyToNull(parsed.data.payee),
    p_payment_method: parsed.data.paymentMethod ?? null,
    p_reference: emptyToNull(parsed.data.reference),
    p_document_reference: emptyToNull(parsed.data.documentReference),
    p_notes: emptyToNull(parsed.data.notes),
    p_client_request_id: parsed.data.clientRequestId,
  });

  if (error) return { error: error.message };
  revalidateFinance(["/dashboard/finance/expenses"]);
  return { error: null };
}

export async function recordActivityExpenseAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_EXPENSE_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordActivityExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const fund = await resolveActivityFundId(parsed.data.activityCode);
  if ("error" in fund) return { error: fund.error };

  return recordExpenseAction({
    ...parsed.data,
    fundId: fund.fundId,
  });
}

export async function recordPettyCashExpenseAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_EXPENSE_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordPettyCashExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const account = await resolvePettyCashAccountId();
  if ("error" in account) return { error: account.error };

  return recordExpenseAction({
    ...parsed.data,
    accountId: account.accountId,
  });
}

export async function addPettyCashAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_TRANSFER_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = addPettyCashSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const account = await resolvePettyCashAccountId();
  if ("error" in account) return { error: account.error };
  if (account.accountId === parsed.data.fromAccountId) {
    return { error: "Choose an account other than petty cash." };
  }

  return recordTransferAction({
    ...parsed.data,
    toAccountId: account.accountId,
  });
}

export async function approveExpenseAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_EXPENSE_APPROVE");
  if (!auth.ok) return { error: auth.error };

  const parsed = approveExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID_INPUT };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_expense", {
    p_expense_id: parsed.data.expenseId,
  });

  if (error) return { error: error.message };
  revalidateFinance(["/dashboard/finance/expenses"]);
  return { error: null };
}

export async function payExpenseAction(input: unknown): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_EXPENSE_PAY");
  if (!auth.ok) return { error: auth.error };

  const parsed = payExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("pay_expense", {
    p_expense_id: parsed.data.expenseId,
    p_account_id: parsed.data.accountId,
    p_paid_on: parsed.data.paidOn,
    p_payment_method: parsed.data.paymentMethod ?? null,
    p_reference: emptyToNull(parsed.data.reference),
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/expenses",
    "/dashboard/finance/accounts",
  ]);
  return { error: null };
}

export async function reverseExpenseAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_REVERSE");
  if (!auth.ok) return { error: auth.error };

  const parsed = reverseExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reverse_expense", {
    p_expense_id: parsed.data.expenseId,
    p_reason: parsed.data.reason,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/expenses",
    "/dashboard/finance/accounts",
  ]);
  return { error: null };
}

export async function recordTransferAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_TRANSFER_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordTransferSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_account_transfer", {
    p_from_account_id: parsed.data.fromAccountId,
    p_to_account_id: parsed.data.toAccountId,
    p_amount: parsed.data.amount,
    p_transfer_date: parsed.data.transferDate,
    p_description: parsed.data.description,
    p_reference: emptyToNull(parsed.data.reference),
    p_client_request_id: parsed.data.clientRequestId,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/transfers",
    "/dashboard/finance/accounts",
    "/dashboard/finance/petty-cash",
  ]);
  return { error: null };
}

export async function reverseTransferAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_REVERSE");
  if (!auth.ok) return { error: auth.error };

  const parsed = reverseTransferSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reverse_account_transfer", {
    p_transfer_id: parsed.data.transferId,
    p_reason: parsed.data.reason,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/transfers",
    "/dashboard/finance/accounts",
  ]);
  return { error: null };
}

export async function recordSalaryAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_SALARY_RECORD");
  if (!auth.ok) return { error: auth.error };

  const parsed = recordSalarySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_salary_payment", {
    p_staff_id: parsed.data.staffId,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
    p_period_label: parsed.data.periodLabel,
    p_gross_amount: parsed.data.grossAmount,
    p_deductions_amount: parsed.data.deductionsAmount,
    p_notes: emptyToNull(parsed.data.notes),
  });

  if (error) return { error: error.message };
  revalidateFinance(["/dashboard/finance/salaries"]);
  return { error: null };
}

export async function approveSalaryAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_SALARY_APPROVE");
  if (!auth.ok) return { error: auth.error };

  const parsed = approveSalarySchema.safeParse(input);
  if (!parsed.success) return { error: INVALID_INPUT };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_salary_payment", {
    p_salary_payment_id: parsed.data.salaryPaymentId,
  });

  if (error) return { error: error.message };
  revalidateFinance(["/dashboard/finance/salaries"]);
  return { error: null };
}

export async function paySalaryAction(input: unknown): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_SALARY_PAY");
  if (!auth.ok) return { error: auth.error };

  const parsed = paySalarySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("pay_salary_payment", {
    p_salary_payment_id: parsed.data.salaryPaymentId,
    p_account_id: parsed.data.accountId,
    p_payment_date: parsed.data.paymentDate,
    p_payment_method: parsed.data.paymentMethod ?? null,
    p_reference: emptyToNull(parsed.data.reference),
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/salaries",
    "/dashboard/finance/accounts",
  ]);
  return { error: null };
}

export async function reverseSalaryAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_REVERSE");
  if (!auth.ok) return { error: auth.error };

  const parsed = reverseSalarySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reverse_salary_payment", {
    p_salary_payment_id: parsed.data.salaryPaymentId,
    p_reason: parsed.data.reason,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/salaries",
    "/dashboard/finance/accounts",
  ]);
  return { error: null };
}

export async function upsertFundAction(input: unknown): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_SETUP_MANAGE");
  if (!auth.ok) return { error: auth.error };

  const parsed = upsertFundSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("upsert_finance_fund", {
    p_fund_id: parsed.data.fundId ?? null,
    p_code: parsed.data.code.toUpperCase(),
    p_name: parsed.data.name,
    p_description: emptyToNull(parsed.data.description),
    p_is_active: parsed.data.isActive,
    p_sort_order: parsed.data.sortOrder,
  });

  if (error) return { error: error.message };
  revalidateFinance(["/dashboard/finance/funds", "/dashboard/finance/settings"]);
  return { error: null };
}

export async function upsertAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertCapability("FINANCE_SETUP_MANAGE");
  if (!auth.ok) return { error: auth.error };

  const parsed = upsertAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("upsert_financial_account", {
    p_account_id: parsed.data.accountId ?? null,
    p_code: parsed.data.code.toUpperCase(),
    p_name: parsed.data.name,
    p_account_type: parsed.data.accountType,
    p_description: emptyToNull(parsed.data.description),
    p_masked_reference: emptyToNull(parsed.data.maskedReference),
    p_opening_balance: parsed.data.openingBalance,
    p_opening_balance_date: emptyToNull(parsed.data.openingBalanceDate),
    p_is_active: parsed.data.isActive,
    p_sort_order: parsed.data.sortOrder,
  });

  if (error) return { error: error.message };
  revalidateFinance([
    "/dashboard/finance/accounts",
    "/dashboard/finance/settings",
  ]);
  return { error: null };
}
