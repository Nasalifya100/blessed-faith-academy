import { createSupabaseServerClient } from "@/lib/supabase/server";

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
        amount: Number(row.amount),
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

  return {
    academicYearName: year?.name ?? null,
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
  amount: number;
  status: string;
  termName: string | null;
  createdAt: string;
}

export interface StatementPayment {
  id: string;
  amount: number;
  method: string;
  receiptNumber: string;
  paidOn: string;
  status: string;
}

export interface StudentFeeStatement {
  academicYearName: string | null;
  currentTermName: string | null;
  currentTermId: string | null;
  charges: StatementCharge[];
  payments: StatementPayment[];
  totalCharged: number;
  totalPaid: number;
  balance: number;
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

  let charges: StatementCharge[] = [];
  if (year?.id) {
    const { data: chargeRows } = await supabase
      .from("charges")
      .select(
        "id, description, amount, status, created_at, fee_item:fee_items(name), term:terms(name)",
      )
      .eq("student_id", studentId)
      .eq("academic_year_id", year.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true });

    charges = (
      (chargeRows as {
        id: string;
        description: string | null;
        amount: number | string;
        status: string;
        created_at: string;
        fee_item: { name: string } | null;
        term: { name: string } | null;
      }[] | null) ?? []
    ).map((row) => ({
      id: row.id,
      description: row.description ?? row.fee_item?.name ?? "Charge",
      feeItemName: row.fee_item?.name ?? "-",
      amount: Number(row.amount),
      status: row.status,
      termName: row.term?.name ?? null,
      createdAt: row.created_at,
    }));
  }

  const { data: paymentRows } = await supabase
    .from("payments")
    .select("id, amount, method, receipt_number, paid_on, status")
    .eq("student_id", studentId)
    .eq("status", "completed")
    .order("paid_on", { ascending: true });

  const payments: StatementPayment[] = (
    (paymentRows as {
      id: string;
      amount: number | string;
      method: string;
      receipt_number: string;
      paid_on: string;
      status: string;
    }[] | null) ?? []
  ).map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    method: row.method,
    receiptNumber: row.receipt_number,
    paidOn: row.paid_on,
    status: row.status,
  }));

  const totalCharged = charges
    .filter((charge) => charge.status !== "waived")
    .reduce((sum, charge) => sum + charge.amount, 0);
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

  return {
    academicYearName: year?.name ?? null,
    currentTermName,
    currentTermId,
    charges,
    payments,
    totalCharged,
    totalPaid,
    balance: totalCharged - totalPaid,
  };
}

export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  referenceNumber: string | null;
  paidOn: string;
  notes: string | null;
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
  balanceAfter: number;
}

export async function getPaymentReceipt(
  paymentId: string,
): Promise<PaymentReceipt | null> {
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("payments")
    .select(
      "id, receipt_number, amount, method, reference_number, paid_on, notes, recorded_by, status, student:students(id, first_name, middle_name, last_name, admission_number), school:schools(name, address, phone)",
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

  if (payment.status !== "completed" || !payment.student || !payment.school) {
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

  // Balance after this payment = all charges − all completed payments up to
  // and including this one (by created time / paid_on).
  const statement = await getStudentFeeStatement(payment.student.id);

  return {
    id: payment.id,
    receiptNumber: payment.receipt_number,
    amount: Number(payment.amount),
    method: payment.method,
    referenceNumber: payment.reference_number,
    paidOn: payment.paid_on,
    notes: payment.notes,
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
  };
}
