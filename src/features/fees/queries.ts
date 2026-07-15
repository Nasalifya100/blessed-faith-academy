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
