import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fromNgwee, subKwacha, toNgwee } from "@/lib/money";

export interface FeeScheduleRow {
  id: string;
  amount: number;
  currency: string;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
  gradeSortOrder: number | null;
}

export interface FeeItemWithSchedules {
  id: string;
  code: string;
  name: string;
  category: string;
  billingFrequency: string;
  isOptional: boolean;
  isActive: boolean;
  sortOrder: number;
  schedules: FeeScheduleRow[];
}

export interface RequirementItemRow {
  id: string;
  name: string;
  band: string;
  quantity: string | null;
  sortOrder: number;
}

export interface FeesSetupData {
  academicYearName: string | null;
  currentTermId: string | null;
  currentTermName: string | null;
  items: FeeItemWithSchedules[];
  requirements: RequirementItemRow[];
}

interface FeeItemRow {
  id: string;
  code: string;
  name: string;
  category: string;
  billing_frequency: string;
  is_optional: boolean;
  is_active: boolean;
  sort_order: number;
}

interface ScheduleJoinRow {
  id: string;
  fee_item_id: string;
  amount: number | string;
  currency: string;
  grade_level_id: string | null;
  grade_level: { name: string; sort_order: number } | null;
}

/**
 * Loads the fee catalogue with schedules for the current academic year,
 * plus the requirements checklist.
 */
export async function getFeesSetupData(): Promise<FeesSetupData> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  const { data: itemRows } = await supabase
    .from("fee_items")
    .select(
      "id, code, name, category, billing_frequency, is_optional, is_active, sort_order",
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const itemsBase = (itemRows as FeeItemRow[] | null) ?? [];

  const schedulesByItem = new Map<string, FeeScheduleRow[]>();

  if (year?.id) {
    const { data: scheduleRows } = await supabase
      .from("fee_schedules")
      .select(
        "id, fee_item_id, amount, currency, grade_level_id, grade_level:grade_levels(name, sort_order)",
      )
      .eq("academic_year_id", year.id)
      .eq("is_active", true);

    for (const row of (scheduleRows as ScheduleJoinRow[] | null) ?? []) {
      const list = schedulesByItem.get(row.fee_item_id) ?? [];
      list.push({
        id: row.id,
        amount: fromNgwee(toNgwee(row.amount)),
        currency: row.currency,
        gradeLevelId: row.grade_level_id,
        gradeLevelName: row.grade_level?.name ?? null,
        gradeSortOrder: row.grade_level?.sort_order ?? null,
      });
      schedulesByItem.set(row.fee_item_id, list);
    }

    for (const [, list] of schedulesByItem) {
      list.sort((a, b) => {
        if (a.gradeSortOrder === null && b.gradeSortOrder === null) return 0;
        if (a.gradeSortOrder === null) return 1;
        if (b.gradeSortOrder === null) return -1;
        return a.gradeSortOrder - b.gradeSortOrder;
      });
    }
  }

  const items: FeeItemWithSchedules[] = itemsBase.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category,
    billingFrequency: item.billing_frequency,
    isOptional: item.is_optional,
    isActive: item.is_active,
    sortOrder: item.sort_order,
    schedules: schedulesByItem.get(item.id) ?? [],
  }));

  const { data: requirementRows } = await supabase
    .from("requirement_items")
    .select("id, name, band, quantity, sort_order")
    .eq("is_active", true)
    .order("band", { ascending: true })
    .order("sort_order", { ascending: true });

  const requirements: RequirementItemRow[] = (
    (requirementRows as {
      id: string;
      name: string;
      band: string;
      quantity: string | null;
      sort_order: number;
    }[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    band: row.band,
    quantity: row.quantity,
    sortOrder: row.sort_order,
  }));

  let currentTermId: string | null = null;
  let currentTermName: string | null = null;
  if (year?.id) {
    const { data: term } = await supabase
      .from("terms")
      .select("id, name")
      .eq("academic_year_id", year.id)
      .eq("is_current", true)
      .maybeSingle();
    currentTermId = term?.id ?? null;
    currentTermName = term?.name ?? null;
  }

  return {
    academicYearName: year?.name ?? null,
    currentTermId,
    currentTermName,
    items,
    requirements,
  };
}

// ---------------------------------------------------------------------------
// Student fee statement
// ---------------------------------------------------------------------------

export interface StatementCharge {
  id: string;
  description: string;
  feeItemName: string;
  category: string;
  isOptional: boolean;
  amount: number;
  allocatedAmount: number;
  remainingAmount: number;
  /** Derived from allocations when possible; status column retained for cancelled/waived. */
  status: string;
  termName: string | null;
  academicYearName: string | null;
  academicYearId: string;
  isBroughtForward: boolean;
  createdAt: string;
  chargeSource: "NORMAL" | "LEGACY_OPENING_BALANCE";
  legacyOriginalAmount: number | null;
  legacyPreviouslyPaidAmount: number | null;
  legacyNotes: string | null;
  migratedAt: string | null;
}

export interface StatementPaymentAllocation {
  id: string;
  chargeId: string;
  chargeDescription: string;
  feeItemName: string;
  academicYearName: string | null;
  termName: string | null;
  amount: number;
  createdAt: string;
  reversedAt: string | null;
}

export interface StatementPayment {
  id: string;
  amount: number;
  amountAllocated: number;
  unallocatedCredit: number;
  method: string;
  receiptNumber: string;
  paidOn: string;
  status: string;
  voidReason: string | null;
  voidedAt: string | null;
  allocations: StatementPaymentAllocation[];
}

export interface StudentFeeStatement {
  academicYearName: string | null;
  currentTermName: string | null;
  currentTermId: string | null;
  /** All active (non-cancelled) charges across years — statement listing. */
  charges: StatementCharge[];
  /** Current-year charges only (for year-scoped views). */
  currentYearCharges: StatementCharge[];
  /** Completed payments only — used for totals. */
  payments: StatementPayment[];
  /** Voided/reversed payments (history; excluded from totals). */
  voidedPayments: StatementPayment[];
  totalCharged: number;
  totalPaid: number;
  totalAllocated: number;
  availableCredit: number;
  /** Authoritative outstanding = remaining charge balances (all years). */
  balance: number;
  broughtForwardOutstanding: number;
  currentYearOutstanding: number;
  currentYearCharged: number;
  netAccountPosition: number;
}

function money(value: number | string | null | undefined): number {
  return fromNgwee(toNgwee(value ?? 0));
}

export async function getStudentFeeStatement(
  studentId: string,
): Promise<StudentFeeStatement> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  let currentTermName: string | null = null;
  let currentTermId: string | null = null;

  if (year?.id) {
    const { data: term } = await supabase
      .from("terms")
      .select("id, name")
      .eq("academic_year_id", year.id)
      .eq("is_current", true)
      .maybeSingle();
    currentTermName = term?.name ?? null;
    currentTermId = term?.id ?? null;
  }

  const { data: summaryRaw } = await supabase.rpc("get_student_finance_summary", {
    p_student_id: studentId,
  });
  const summary = (summaryRaw ?? {}) as Record<string, unknown>;

  const { data: chargeRows } = await supabase
    .from("charges")
    .select(
      "id, description, amount, status, created_at, academic_year_id, charge_source, legacy_original_amount, legacy_previously_paid_amount, legacy_notes, migrated_at, fee_item:fee_items(name, category, is_optional), term:terms(name), academic_year:academic_years(name)",
    )
    .eq("student_id", studentId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });

  const chargeIds =
    ((chargeRows as { id: string }[] | null) ?? []).map((row) => row.id);

  const allocatedByCharge = new Map<string, number>();
  if (chargeIds.length > 0) {
    const { data: allocRows } = await supabase
      .from("payment_allocations")
      .select("charge_id, amount, payment:payments!inner(status)")
      .in("charge_id", chargeIds)
      .is("reversed_at", null);

    for (const row of (allocRows as {
      charge_id: string;
      amount: number | string;
      payment: { status: string } | null;
    }[] | null) ?? []) {
      if (row.payment?.status !== "completed") continue;
      allocatedByCharge.set(
        row.charge_id,
        (allocatedByCharge.get(row.charge_id) ?? 0) + toNgwee(row.amount),
      );
    }
  }

  const charges: StatementCharge[] = (
    (chargeRows as {
      id: string;
      description: string | null;
      amount: number | string;
      status: string;
      created_at: string;
      academic_year_id: string;
      charge_source: string | null;
      legacy_original_amount: number | string | null;
      legacy_previously_paid_amount: number | string | null;
      legacy_notes: string | null;
      migrated_at: string | null;
      fee_item: {
        name: string;
        category: string;
        is_optional: boolean;
      } | null;
      term: { name: string } | null;
      academic_year: { name: string } | null;
    }[] | null) ?? []
  ).map((row) => {
    const isLegacy = row.charge_source === "LEGACY_OPENING_BALANCE";
    const amount = money(row.amount);
    const allocatedAmount = fromNgwee(allocatedByCharge.get(row.id) ?? 0);
    const remainingAmount =
      row.status === "waived"
        ? 0
        : fromNgwee(Math.max(0, toNgwee(amount) - toNgwee(allocatedAmount)));
    const derivedStatus =
      row.status === "waived" || row.status === "cancelled"
        ? row.status
        : remainingAmount <= 0
          ? "paid"
          : allocatedAmount > 0
            ? "outstanding"
            : row.status;

    return {
      id: row.id,
      description: isLegacy
        ? row.description?.trim() ||
          `Opening balance — ${row.fee_item?.name ?? "Fee"}`
        : (row.fee_item?.name ?? row.description ?? "Charge"),
      feeItemName: row.fee_item?.name ?? "-",
      category: row.fee_item?.category ?? "other",
      isOptional: row.fee_item?.is_optional ?? false,
      amount,
      allocatedAmount,
      remainingAmount,
      status: derivedStatus,
      termName: row.term?.name ?? null,
      academicYearName: row.academic_year?.name ?? null,
      academicYearId: row.academic_year_id,
      isBroughtForward: Boolean(year?.id && row.academic_year_id !== year.id),
      createdAt: row.created_at,
      chargeSource: isLegacy ? "LEGACY_OPENING_BALANCE" : "NORMAL",
      legacyOriginalAmount:
        row.legacy_original_amount != null
          ? money(row.legacy_original_amount)
          : null,
      legacyPreviouslyPaidAmount:
        row.legacy_previously_paid_amount != null
          ? money(row.legacy_previously_paid_amount)
          : null,
      legacyNotes: row.legacy_notes,
      migratedAt: row.migrated_at,
    };
  });

  const currentYearCharges = year?.id
    ? charges.filter((charge) => charge.academicYearId === year.id)
    : charges;

  const { data: paymentRows } = await supabase
    .from("payments")
    .select(
      "id, amount, method, receipt_number, paid_on, status, void_reason, voided_at",
    )
    .eq("student_id", studentId)
    .in("status", ["completed", "voided"])
    .order("paid_on", { ascending: true });

  const paymentIds =
    ((paymentRows as { id: string }[] | null) ?? []).map((row) => row.id);

  const allocationsByPayment = new Map<string, StatementPaymentAllocation[]>();
  if (paymentIds.length > 0) {
    const { data: paymentAllocRows } = await supabase
      .from("payment_allocations")
      .select(
        "id, payment_id, charge_id, amount, created_at, reversed_at, charge:charges(description, fee_item:fee_items(name), term:terms(name), academic_year:academic_years(name))",
      )
      .in("payment_id", paymentIds)
      .order("created_at", { ascending: true });

    for (const row of (paymentAllocRows as {
      id: string;
      payment_id: string;
      charge_id: string;
      amount: number | string;
      created_at: string;
      reversed_at: string | null;
      charge: {
        description: string | null;
        fee_item: { name: string } | null;
        term: { name: string } | null;
        academic_year: { name: string } | null;
      } | null;
    }[] | null) ?? []) {
      const list = allocationsByPayment.get(row.payment_id) ?? [];
      list.push({
        id: row.id,
        chargeId: row.charge_id,
        chargeDescription:
          row.charge?.fee_item?.name ??
          row.charge?.description ??
          "Charge",
        feeItemName: row.charge?.fee_item?.name ?? "-",
        academicYearName: row.charge?.academic_year?.name ?? null,
        termName: row.charge?.term?.name ?? null,
        amount: money(row.amount),
        createdAt: row.created_at,
        reversedAt: row.reversed_at,
      });
      allocationsByPayment.set(row.payment_id, list);
    }
  }

  const mappedPayments: StatementPayment[] = (
    (paymentRows as {
      id: string;
      amount: number | string;
      method: string;
      receipt_number: string;
      paid_on: string;
      status: string;
      void_reason: string | null;
      voided_at: string | null;
    }[] | null) ?? []
  ).map((row) => {
    const amount = money(row.amount);
    const allocations = allocationsByPayment.get(row.id) ?? [];
    const activeAllocNgwee = allocations
      .filter((a) => !a.reversedAt)
      .reduce((sum, a) => sum + toNgwee(a.amount), 0);
    const amountAllocated = fromNgwee(activeAllocNgwee);
    const unallocatedCredit =
      row.status === "completed"
        ? fromNgwee(Math.max(0, toNgwee(amount) - activeAllocNgwee))
        : 0;

    return {
      id: row.id,
      amount,
      amountAllocated,
      unallocatedCredit,
      method: row.method,
      receiptNumber: row.receipt_number,
      paidOn: row.paid_on,
      status: row.status,
      voidReason: row.void_reason,
      voidedAt: row.voided_at,
      allocations,
    };
  });

  const payments = mappedPayments.filter((p) => p.status === "completed");
  const voidedPayments = mappedPayments.filter((p) => p.status === "voided");

  const totalCharged =
    summary.total_active_charges != null
      ? money(summary.total_active_charges as number | string)
      : fromNgwee(
          charges
            .filter((c) => c.status !== "waived")
            .reduce((sum, c) => sum + toNgwee(c.amount), 0),
        );
  const totalPaid =
    summary.total_completed_payments != null
      ? money(summary.total_completed_payments as number | string)
      : fromNgwee(payments.reduce((sum, p) => sum + toNgwee(p.amount), 0));
  const totalAllocated = money(
    (summary.total_allocated as number | string | undefined) ?? 0,
  );
  const availableCredit = money(
    (summary.available_credit as number | string | undefined) ?? 0,
  );
  const balance = money(
    (summary.outstanding_balance as number | string | undefined) ?? 0,
  );
  const broughtForwardOutstanding = money(
    (summary.brought_forward_outstanding as number | string | undefined) ?? 0,
  );
  const currentYearOutstanding = money(
    (summary.current_year_outstanding as number | string | undefined) ?? 0,
  );
  const currentYearCharged = money(
    (summary.current_year_charges as number | string | undefined) ?? 0,
  );
  const netAccountPosition = money(
    (summary.net_account_position as number | string | undefined) ??
      subKwacha(balance, availableCredit),
  );

  return {
    academicYearName: year?.name ?? null,
    currentTermName,
    currentTermId,
    charges,
    currentYearCharges,
    payments,
    voidedPayments,
    totalCharged,
    totalPaid,
    totalAllocated,
    availableCredit,
    balance,
    broughtForwardOutstanding,
    currentYearOutstanding,
    currentYearCharged,
    netAccountPosition,
  };
}

// ---------------------------------------------------------------------------
// Optional meal / uniform opt-in options
// ---------------------------------------------------------------------------

export interface OptionalFeeOption {
  id: string;
  code: string;
  name: string;
  category: "meal" | "uniform";
  billingFrequency: string;
  amount: number;
  alreadyCharged: boolean;
}

export interface OptionalFeeOptions {
  academicYearName: string | null;
  currentTermId: string | null;
  currentTermName: string | null;
  meals: OptionalFeeOption[];
  uniforms: OptionalFeeOption[];
  activeMealFeeItemId: string | null;
}

export async function getOptionalFeeOptions(
  studentId: string,
): Promise<OptionalFeeOptions> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  let currentTermId: string | null = null;
  let currentTermName: string | null = null;

  if (year?.id) {
    const { data: term } = await supabase
      .from("terms")
      .select("id, name")
      .eq("academic_year_id", year.id)
      .eq("is_current", true)
      .maybeSingle();
    currentTermId = term?.id ?? null;
    currentTermName = term?.name ?? null;
  }

  const { data: itemRows } = await supabase
    .from("fee_items")
    .select("id, code, name, category, billing_frequency, sort_order")
    .eq("is_active", true)
    .eq("is_optional", true)
    .in("category", ["meal", "uniform"])
    .order("sort_order", { ascending: true });

  const items =
    (itemRows as {
      id: string;
      code: string;
      name: string;
      category: string;
      billing_frequency: string;
      sort_order: number;
    }[] | null) ?? [];

  const amountByItem = new Map<string, number>();
  if (year?.id && items.length > 0) {
    const { data: scheduleRows } = await supabase
      .from("fee_schedules")
      .select("fee_item_id, amount, grade_level_id")
      .eq("academic_year_id", year.id)
      .eq("is_active", true)
      .in(
        "fee_item_id",
        items.map((item) => item.id),
      );

    for (const row of (scheduleRows as {
      fee_item_id: string;
      amount: number | string;
      grade_level_id: string | null;
    }[] | null) ?? []) {
      // Prefer school-wide (null grade) for optional items; first wins
      if (!amountByItem.has(row.fee_item_id) || row.grade_level_id === null) {
        amountByItem.set(row.fee_item_id, fromNgwee(toNgwee(row.amount)));
      }
    }
  }

  const mealItemIds = new Set(
    items.filter((item) => item.category === "meal").map((item) => item.id),
  );
  const uniformItemIds = new Set(
    items.filter((item) => item.category === "uniform").map((item) => item.id),
  );

  const chargedItemIds = new Set<string>();
  let activeMealFeeItemId: string | null = null;

  if (year?.id) {
    const { data: chargeRows } = await supabase
      .from("charges")
      .select("fee_item_id, term_id")
      .eq("student_id", studentId)
      .eq("academic_year_id", year.id)
      .neq("status", "cancelled");

    for (const row of (chargeRows as {
      fee_item_id: string;
      term_id: string | null;
    }[] | null) ?? []) {
      if (mealItemIds.has(row.fee_item_id)) {
        if (currentTermId && row.term_id === currentTermId) {
          chargedItemIds.add(row.fee_item_id);
          activeMealFeeItemId = row.fee_item_id;
        }
      } else if (uniformItemIds.has(row.fee_item_id)) {
        chargedItemIds.add(row.fee_item_id);
      }
    }
  }

  const meals: OptionalFeeOption[] = [];
  const uniforms: OptionalFeeOption[] = [];

  for (const item of items) {
    if (item.category !== "meal" && item.category !== "uniform") {
      continue;
    }
    const option: OptionalFeeOption = {
      id: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      billingFrequency: item.billing_frequency,
      amount: amountByItem.get(item.id) ?? 0,
      alreadyCharged: chargedItemIds.has(item.id),
    };
    if (item.category === "meal") {
      meals.push(option);
    } else {
      uniforms.push(option);
    }
  }

  return {
    academicYearName: year?.name ?? null,
    currentTermId,
    currentTermName,
    meals,
    uniforms,
    activeMealFeeItemId,
  };
}

// ---------------------------------------------------------------------------
// Student requirements checklist (not money)
// ---------------------------------------------------------------------------

export type RequirementBand = "preschool" | "lower" | "upper" | "all";

export interface StudentRequirementRow {
  id: string;
  name: string;
  band: RequirementBand;
  quantity: string | null;
  isReceived: boolean;
  receivedOn: string | null;
  notes: string;
}

export interface StudentRequirementsChecklist {
  academicYearName: string | null;
  gradeLevelName: string | null;
  band: RequirementBand | null;
  items: StudentRequirementRow[];
  receivedCount: number;
  totalCount: number;
}

/** Map grade sort_order (Baby=1 … Grade 7=11) to Sheet 1 requirement band. */
function bandFromGradeSortOrder(sortOrder: number): RequirementBand {
  if (sortOrder <= 4) return "preschool";
  if (sortOrder <= 8) return "lower";
  return "upper";
}

export async function getStudentRequirementsChecklist(
  studentId: string,
): Promise<StudentRequirementsChecklist> {
  const supabase = await createSupabaseServerClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  let gradeLevelName: string | null = null;
  let band: RequirementBand | null = null;

  if (year?.id) {
    const { data: enrolment } = await supabase
      .from("student_class_enrollments")
      .select(
        "class:classes(grade_level:grade_levels(name, sort_order))",
      )
      .eq("student_id", studentId)
      .eq("academic_year_id", year.id)
      .eq("status", "active")
      .maybeSingle();

    const grade = (
      enrolment as {
        class: {
          grade_level: { name: string; sort_order: number } | null;
        } | null;
      } | null
    )?.class?.grade_level;

    if (grade) {
      gradeLevelName = grade.name;
      band = bandFromGradeSortOrder(grade.sort_order);
    }
  }

  const bandsToLoad: RequirementBand[] = band
    ? [band, "all"]
    : ["preschool", "lower", "upper", "all"];

  const { data: itemRows } = await supabase
    .from("requirement_items")
    .select("id, name, band, quantity, sort_order")
    .eq("is_active", true)
    .in("band", bandsToLoad)
    .order("sort_order", { ascending: true });

  const itemsBase =
    (itemRows as {
      id: string;
      name: string;
      band: string;
      quantity: string | null;
      sort_order: number;
    }[] | null) ?? [];

  // Prefer the student's band items; if no grade yet, show nothing specific
  const filtered =
    band != null
      ? itemsBase.filter(
          (item) => item.band === band || item.band === "all",
        )
      : [];

  const receivedByItem = new Map<
    string,
    { isReceived: boolean; receivedOn: string | null; notes: string }
  >();

  if (year?.id && filtered.length > 0) {
    const { data: checkRows } = await supabase
      .from("student_requirement_checks")
      .select("requirement_item_id, is_received, received_on, notes")
      .eq("student_id", studentId)
      .eq("academic_year_id", year.id)
      .in(
        "requirement_item_id",
        filtered.map((item) => item.id),
      );

    for (const row of (checkRows as {
      requirement_item_id: string;
      is_received: boolean;
      received_on: string | null;
      notes: string | null;
    }[] | null) ?? []) {
      receivedByItem.set(row.requirement_item_id, {
        isReceived: row.is_received,
        receivedOn: row.received_on,
        notes: row.notes ?? "",
      });
    }
  }

  const items: StudentRequirementRow[] = filtered.map((item) => {
    const check = receivedByItem.get(item.id);
    return {
      id: item.id,
      name: item.name,
      band: item.band as RequirementBand,
      quantity: item.quantity,
      isReceived: check?.isReceived ?? false,
      receivedOn: check?.receivedOn ?? null,
      notes: check?.notes ?? "",
    };
  });

  const receivedCount = items.filter((item) => item.isReceived).length;

  return {
    academicYearName: year?.name ?? null,
    gradeLevelName,
    band,
    items,
    receivedCount,
    totalCount: items.length,
  };
}

export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  amount: number;
  amountAllocated: number;
  creditCreated: number;
  method: string;
  referenceNumber: string | null;
  paidOn: string;
  notes: string | null;
  status: string;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  recordedByName: string | null;
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
  };
  school: {
    name: string;
    address: string | null;
    phone: string | null;
  };
  /** Remaining outstanding charges after this payment (authoritative). */
  balanceAfter: number;
  /** Available pupil credit after this payment. */
  availableCreditAfter: number;
  allocations: StatementPaymentAllocation[];
}

export async function getPaymentReceipt(
  paymentId: string,
): Promise<PaymentReceipt | null> {
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("payments")
    .select(
      "id, receipt_number, amount, method, reference_number, paid_on, notes, recorded_by, status, void_reason, voided_at, voided_by, student:students(id, first_name, middle_name, last_name, admission_number), school:schools(name, address, phone)",
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (!row) {
    return null;
  }

  const payment = row as unknown as {
    id: string;
    receipt_number: string;
    amount: number | string;
    method: string;
    reference_number: string | null;
    paid_on: string;
    notes: string | null;
    recorded_by: string | null;
    status: string;
    void_reason: string | null;
    voided_at: string | null;
    voided_by: string | null;
    student: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      admission_number: string;
    } | null;
    school: {
      name: string;
      address: string | null;
      phone: string | null;
    } | null;
  };

  if (
    (payment.status !== "completed" && payment.status !== "voided") ||
    !payment.student ||
    !payment.school
  ) {
    return null;
  }

  let recordedByName: string | null = null;
  if (payment.recorded_by) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", payment.recorded_by)
      .maybeSingle();
    recordedByName = profile?.full_name ?? null;
  }

  let voidedByName: string | null = null;
  if (payment.voided_by) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", payment.voided_by)
      .maybeSingle();
    voidedByName = profile?.full_name ?? null;
  }

  const statement = await getStudentFeeStatement(payment.student.id);
  const statementPayment =
    statement.payments.find((row) => row.id === payment.id) ??
    statement.voidedPayments.find((row) => row.id === payment.id);

  const amount = money(payment.amount);
  const amountAllocated = statementPayment?.amountAllocated ?? 0;
  const creditCreated =
    payment.status === "completed"
      ? (statementPayment?.unallocatedCredit ??
        fromNgwee(Math.max(0, toNgwee(amount) - toNgwee(amountAllocated))))
      : 0;

  return {
    id: payment.id,
    receiptNumber: payment.receipt_number,
    amount,
    amountAllocated,
    creditCreated,
    method: payment.method,
    referenceNumber: payment.reference_number,
    paidOn: payment.paid_on,
    notes: payment.notes,
    status: payment.status,
    voidReason: payment.void_reason,
    voidedAt: payment.voided_at,
    voidedByName,
    recordedByName,
    student: {
      id: payment.student.id,
      fullName: [
        payment.student.first_name,
        payment.student.middle_name,
        payment.student.last_name,
      ]
        .filter(Boolean)
        .join(" "),
      admissionNumber: payment.student.admission_number,
    },
    school: {
      name: payment.school.name,
      address: payment.school.address,
      phone: payment.school.phone,
    },
    balanceAfter: statement.balance,
    availableCreditAfter: statement.availableCredit,
    allocations: statementPayment?.allocations.filter((a) => !a.reversedAt) ?? [],
  };
}
