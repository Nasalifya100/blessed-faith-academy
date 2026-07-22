"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  applyAvailableCreditSchema,
  cancelOptionalChargeSchema,
  generateClassChargesSchema,
  generateStudentChargesSchema,
  optInOptionalFeesSchema,
  recordPaymentSchema,
  setRequirementReceivedSchema,
  updateScheduleAmountSchema,
  voidPaymentSchema,
} from "./schemas";
import { previewPaymentApplication } from "./payment-preview";
import { fromNgwee, toNgwee } from "@/lib/money";


export interface ActionResult {
  error: string | null;
}

const FEE_MANAGER_ROLES = ["administrator", "bursar", "headteacher"];
const REQUIREMENT_TRACKER_ROLES = [
  "administrator",
  "bursar",
  "headteacher",
  "secretary",
];
const CONNECTION_ERROR =
  "Couldn't reach the server to verify your account. Check your internet connection and try again.";
const SESSION_ERROR = "Your session has expired. Please sign in again.";

async function assertFeeManager(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { ok: false, error: CONNECTION_ERROR };
  }
  const role = current.profile?.role;
  if (
    current.profile?.is_active &&
    role &&
    FEE_MANAGER_ROLES.includes(role)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "You are not authorized to manage fees.",
  };
}

async function assertRequirementTracker(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) {
    return { ok: false, error: SESSION_ERROR };
  }
  if (current.profileLoadFailed) {
    return { ok: false, error: CONNECTION_ERROR };
  }
  const role = current.profile?.role;
  if (
    current.profile?.is_active &&
    role &&
    REQUIREMENT_TRACKER_ROLES.includes(role)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "You are not authorized to update requirements.",
  };
}

export async function updateScheduleAmountAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = updateScheduleAmountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid amount.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("fee_schedules")
    .update({ amount: parsed.data.amount })
    .eq("id", parsed.data.scheduleId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/fees");
  return { error: null };
}

export interface GenerateChargesResult {
  error: string | null;
  createdCount: number;
}

export async function generateStudentChargesAction(
  input: unknown,
): Promise<GenerateChargesResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, createdCount: 0 };
  }

  const parsed = generateStudentChargesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid student.", createdCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_charges_for_student", {
    p_student_id: parsed.data.studentId,
    p_term_id: parsed.data.termId ?? null,
  });

  if (error) {
    return { error: error.message, createdCount: 0 };
  }

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  revalidatePath("/dashboard/students");
  return {
    error: null,
    createdCount: typeof data === "number" ? data : Number(data) || 0,
  };
}

export async function generateClassChargesAction(
  input: unknown,
): Promise<GenerateChargesResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, createdCount: 0 };
  }

  const parsed = generateClassChargesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid class.", createdCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_charges_for_class", {
    p_class_id: parsed.data.classId,
    p_term_id: parsed.data.termId ?? null,
  });

  if (error) {
    return { error: error.message, createdCount: 0 };
  }

  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/fees");
  return {
    error: null,
    createdCount: typeof data === "number" ? data : Number(data) || 0,
  };
}

export interface RecordPaymentResult {
  error: string | null;
  paymentId: string | null;
  amountAllocated?: number | null;
  creditCreated?: number | null;
}

function parseRecordPaymentRpc(data: unknown): {
  paymentId: string | null;
  amountAllocated: number | null;
  creditCreated: number | null;
} {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const row = data as Record<string, unknown>;
    const paymentId =
      typeof row.payment_id === "string" ? row.payment_id : null;
    return {
      paymentId,
      amountAllocated:
        row.amount_allocated != null
          ? fromNgwee(toNgwee(row.amount_allocated as number | string))
          : null,
      creditCreated:
        row.credit_created != null
          ? fromNgwee(toNgwee(row.credit_created as number | string))
          : null,
    };
  }
  if (typeof data === "string") {
    return {
      paymentId: data,
      amountAllocated: null,
      creditCreated: null,
    };
  }
  return { paymentId: null, amountAllocated: null, creditCreated: null };
}

export async function recordPaymentAction(
  input: unknown,
): Promise<RecordPaymentResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, paymentId: null };
  }

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
      paymentId: null,
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: summaryRaw } = await supabase.rpc("get_student_finance_summary", {
    p_student_id: data.studentId,
  });
  const summary = (summaryRaw ?? {}) as Record<string, unknown>;
  const outstanding = fromNgwee(
    toNgwee((summary.outstanding_balance as number | string | undefined) ?? 0),
  );
  const preview = previewPaymentApplication({
    amountReceived: data.amount,
    outstandingBalance: outstanding,
  });

  if (preview.createsCredit && data.confirmCredit !== true) {
    return {
      error:
        "Confirm that the unapplied amount will remain on the pupil’s account as available credit.",
      paymentId: null,
    };
  }

  const { data: rpcData, error } = await supabase.rpc("record_payment", {
    p_student_id: data.studentId,
    p_amount: data.amount,
    p_method: data.method,
    p_idempotency_key: data.idempotencyKey,
    p_reference_number: data.reference_number?.trim() ?? "",
    p_paid_on: data.paid_on,
    p_notes: data.notes?.trim() ?? "",
  });

  if (error) {
    return { error: error.message, paymentId: null };
  }

  const parsedRpc = parseRecordPaymentRpc(rpcData);
  revalidatePath(`/dashboard/students/${data.studentId}`);
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/reports/fee-balances");
  if (parsedRpc.paymentId) {
    revalidatePath(`/dashboard/payments/${parsedRpc.paymentId}/receipt`);
  }
  return {
    error: null,
    paymentId: parsedRpc.paymentId,
    amountAllocated: parsedRpc.amountAllocated,
    creditCreated: parsedRpc.creditCreated,
  };
}

export interface ApplyCreditResult {
  error: string | null;
  creditApplied: number | null;
}

export async function applyAvailableCreditAction(
  input: unknown,
): Promise<ApplyCreditResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, creditApplied: null };
  }

  const parsed = applyAvailableCreditSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please confirm the action.",
      creditApplied: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("apply_available_credit", {
    p_student_id: parsed.data.studentId,
  });

  if (error) {
    return { error: error.message, creditApplied: null };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const creditApplied =
    row.credit_applied != null
      ? fromNgwee(toNgwee(row.credit_applied as number | string))
      : null;

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/reports/fee-balances");
  return { error: null, creditApplied };
}

export async function voidPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = voidPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("void_payment", {
    p_payment_id: data.paymentId,
    p_reason: data.reason.trim(),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${data.studentId}`);
  revalidatePath(`/dashboard/payments/${data.paymentId}/receipt`);
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/reports/fee-balances");
  return { error: null };
}

export interface OptInOptionalFeesResult {
  error: string | null;
  createdCount: number;
}

export async function optInOptionalFeesAction(
  input: unknown,
): Promise<OptInOptionalFeesResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error, createdCount: 0 };
  }

  const parsed = optInOptionalFeesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
      createdCount: 0,
    };
  }

  const { studentId, termId, mealFeeItemId, uniformFeeItemIds } = parsed.data;
  const feeItemIds = [
    ...(mealFeeItemId ? [mealFeeItemId] : []),
    ...uniformFeeItemIds,
  ];

  if (feeItemIds.length === 0) {
    return {
      error: "Select a meal plan and/or at least one uniform item.",
      createdCount: 0,
    };
  }

  const supabase = await createSupabaseServerClient();
  let createdCount = 0;

  for (const feeItemId of feeItemIds) {
    const { data, error } = await supabase.rpc("create_optional_charge", {
      p_student_id: studentId,
      p_fee_item_id: feeItemId,
      p_term_id: termId ?? null,
    });

    if (error) {
      return { error: error.message, createdCount };
    }
    if (data) {
      createdCount += 1;
    }
  }

  revalidatePath(`/dashboard/students/${studentId}`);
  return { error: null, createdCount };
}

export async function setRequirementReceivedAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertRequirementTracker();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = setRequirementReceivedSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_requirement_received", {
    p_student_id: data.studentId,
    p_requirement_item_id: data.requirementItemId,
    p_is_received: data.isReceived,
    p_notes: data.notes?.trim() ?? "",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${data.studentId}`);
  return { error: null };
}

export async function cancelOptionalChargeAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await assertFeeManager();
  if (!auth.ok) {
    return { error: auth.error };
  }

  const parsed = cancelOptionalChargeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid charge." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_optional_charge", {
    p_charge_id: parsed.data.chargeId,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/students/${parsed.data.studentId}`);
  return { error: null };
}
