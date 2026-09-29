import { z } from "zod";

import { toNgwee } from "@/lib/money";

export const FINANCIAL_ACCOUNT_TYPES = [
  "bank",
  "mobile_money",
  "petty_cash",
] as const;

export const FINANCIAL_ACCOUNT_TYPE_LABELS: Record<
  (typeof FINANCIAL_ACCOUNT_TYPES)[number],
  string
> = {
  bank: "Bank account",
  mobile_money: "Mobile money",
  petty_cash: "Petty cash",
};

export const DISBURSEMENT_METHODS = [
  "cash",
  "mobile_money",
  "bank_transfer",
  "cheque",
] as const;

export const DISBURSEMENT_METHOD_LABELS: Record<
  (typeof DISBURSEMENT_METHODS)[number],
  string
> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  recorded: "Recorded",
  approved: "Approved",
  paid: "Paid",
  reversed: "Reversed",
};

export const SALARY_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  paid: "Paid",
  reversed: "Reversed",
};

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment: "Adjustment",
};

/**
 * Amounts are entered as positive Kwacha with at most two decimal places.
 * Direction is decided by the operation, never by the sign of the input
 * (FIN-01).
 */
const moneyAmount = z
  .number()
  .positive("Amount must be greater than zero")
  .max(99_999_999.99, "Amount is too large")
  .refine(
    (value) => Number.isFinite(value) && toNgwee(value) > 0,
    "Amount must be greater than zero",
  )
  // The value in ngwee must be a whole number, so a third decimal place is
  // rejected rather than silently rounded into someone's account.
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-4,
    "Amount must have at most two decimal places",
  );

const isoDate = z
  .string()
  .min(1, "A date is required")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date");

const optionalText = z.string().trim().max(200).optional().or(z.literal(""));

const reversalReason = z
  .string()
  .trim()
  .min(5, "Explain why this is being reversed (at least 5 characters)")
  .max(500);

export const recordFundIncomeSchema = z.object({
  fundId: z.string().uuid("Choose a fund"),
  accountId: z.string().uuid("Choose where the money was received"),
  amount: moneyAmount,
  receivedOn: isoDate,
  description: z
    .string()
    .trim()
    .min(3, "Describe what this money is for")
    .max(300),
  reference: optionalText,
  payer: optionalText,
  clientRequestId: z.string().uuid("A request id is required"),
});

export type RecordFundIncomeInput = z.infer<typeof recordFundIncomeSchema>;

export const recordExpenseSchema = z.object({
  categoryId: z.string().uuid("Choose an expense category"),
  fundId: z.string().uuid("Choose which activity bears this cost"),
  accountId: z.string().uuid("Choose which account will pay"),
  amount: moneyAmount,
  expenseDate: isoDate,
  description: z
    .string()
    .trim()
    .min(3, "Describe what was bought or paid for")
    .max(300),
  payee: optionalText,
  paymentMethod: z.enum(DISBURSEMENT_METHODS).optional(),
  reference: optionalText,
  documentReference: optionalText,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  clientRequestId: z.string().uuid("A request id is required"),
});

export type RecordExpenseInput = z.infer<typeof recordExpenseSchema>;

export const approveExpenseSchema = z.object({
  expenseId: z.string().uuid(),
});

export const payExpenseSchema = z.object({
  expenseId: z.string().uuid(),
  accountId: z.string().uuid("Choose the paying account"),
  paidOn: isoDate,
  paymentMethod: z.enum(DISBURSEMENT_METHODS).optional(),
  reference: optionalText,
});

export type PayExpenseInput = z.infer<typeof payExpenseSchema>;

export const reverseExpenseSchema = z.object({
  expenseId: z.string().uuid(),
  reason: reversalReason,
});

export const recordTransferSchema = z
  .object({
    fromAccountId: z.string().uuid("Choose the account the money leaves"),
    toAccountId: z.string().uuid("Choose the account the money arrives in"),
    amount: moneyAmount,
    transferDate: isoDate,
    description: z
      .string()
      .trim()
      .min(3, "Describe why the money is being moved")
      .max(300),
    reference: optionalText,
    clientRequestId: z.string().uuid("A request id is required"),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  });

export type RecordTransferInput = z.infer<typeof recordTransferSchema>;

const contextualActivityCode = z.enum(["UNIFORMS", "MEALS", "TUCK_SHOP"]);

/** Contextual income. The fund is not accepted from the browser. */
export const recordActivityIncomeSchema = z.object({
  activityCode: contextualActivityCode,
  accountId: z.string().uuid("Choose where the money was received"),
  amount: moneyAmount,
  receivedOn: isoDate,
  description: z
    .string()
    .trim()
    .min(3, "Describe what this money is for")
    .max(300),
  reference: optionalText,
  payer: optionalText,
  clientRequestId: z.string().uuid("A request id is required"),
});

/** Contextual expense. The fund is not accepted from the browser. */
export const recordActivityExpenseSchema = recordExpenseSchema
  .omit({ fundId: true })
  .extend({ activityCode: contextualActivityCode });

/** Petty-cash spend. The paying account is not accepted from the browser. */
export const recordPettyCashExpenseSchema = recordExpenseSchema.omit({
  accountId: true,
});

/** Petty-cash top-up. The destination account is not accepted from the browser. */
export const addPettyCashSchema = z.object({
  fromAccountId: z.string().uuid("Choose the account the money leaves"),
  amount: moneyAmount,
  transferDate: isoDate,
  description: z
    .string()
    .trim()
    .min(3, "Describe why the money is being moved")
    .max(300),
  reference: optionalText,
  clientRequestId: z.string().uuid("A request id is required"),
});

export const reverseTransferSchema = z.object({
  transferId: z.string().uuid(),
  reason: reversalReason,
});

export const reverseLedgerEntrySchema = z.object({
  entryId: z.string().uuid(),
  reason: reversalReason,
});

export const recordSalarySchema = z
  .object({
    staffId: z.string().uuid("Choose a staff member"),
    periodStart: isoDate,
    periodEnd: isoDate,
    periodLabel: z
      .string()
      .trim()
      .min(3, "Name the pay period, for example “September 2026”")
      .max(80),
    grossAmount: moneyAmount,
    deductionsAmount: z
      .number()
      .min(0, "Deductions cannot be negative")
      .max(99_999_999.99, "Deductions are too large")
      .default(0),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine(
    (value) => Date.parse(value.periodEnd) >= Date.parse(value.periodStart),
    { message: "The period end cannot be before its start", path: ["periodEnd"] },
  )
  .refine((value) => value.deductionsAmount <= value.grossAmount, {
    message: "Deductions cannot exceed the gross amount",
    path: ["deductionsAmount"],
  });

export type RecordSalaryInput = z.infer<typeof recordSalarySchema>;

export const approveSalarySchema = z.object({
  salaryPaymentId: z.string().uuid(),
});

export const paySalarySchema = z.object({
  salaryPaymentId: z.string().uuid(),
  accountId: z.string().uuid("Choose the paying account"),
  paymentDate: isoDate,
  paymentMethod: z.enum(DISBURSEMENT_METHODS).optional(),
  reference: optionalText,
});

export type PaySalaryInput = z.infer<typeof paySalarySchema>;

export const reverseSalarySchema = z.object({
  salaryPaymentId: z.string().uuid(),
  reason: reversalReason,
});

export const upsertFundSchema = z.object({
  fundId: z.string().uuid().nullable().optional(),
  code: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]{1,39}$/,
      "Use 2–40 letters, numbers, or underscores, starting with a letter",
    ),
  name: z.string().trim().min(2, "Enter a fund name").max(80),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const upsertAccountSchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  code: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]{1,39}$/,
      "Use 2–40 letters, numbers, or underscores, starting with a letter",
    ),
  name: z.string().trim().min(2, "Enter an account name").max(80),
  accountType: z.enum(FINANCIAL_ACCOUNT_TYPES),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  // Masked tail only. A full account number must never reach the database.
  maskedReference: z
    .string()
    .trim()
    .max(12, "Enter only the last few digits, for example ****4321")
    .optional()
    .or(z.literal("")),
  openingBalance: z
    .number()
    .min(0, "An opening balance cannot be negative")
    .max(99_999_999.99, "Opening balance is too large")
    .default(0),
  openingBalanceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date this balance was true"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const financePeriodSchema = z.object({
  from: z.string().optional().or(z.literal("")),
  to: z.string().optional().or(z.literal("")),
});
