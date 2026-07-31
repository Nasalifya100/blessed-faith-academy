import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePageParams, MAX_PAGE_SIZE } from "@/lib/ops/pagination";

export type AuditModule = "academic" | "finance" | "password_reset" | "report_card";

export type AuditListFilters = {
  module?: AuditModule | "all";
  eventType?: string;
  actorId?: string;
  outcome?: "all" | "success" | "failure";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type AuditListItem = {
  id: string;
  module: AuditModule;
  eventType: string;
  actorId: string | null;
  resourceId: string | null;
  createdAt: string;
  outcome: "success" | "failure" | "unknown";
  summary: string;
};

export type AuditListResult = {
  items: AuditListItem[];
  page: number;
  pageSize: number;
  /** Exact totals are expensive; this is a soft total for the current fetch window. */
  fetched: number;
  hasMore: boolean;
};

function sanitizeMetadata(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "—";
  try {
    const keys = Object.keys(meta as object).slice(0, 8);
    return keys.length ? `fields: ${keys.join(", ")}` : "—";
  } catch {
    return "—";
  }
}

/**
 * Read-only unified audit feed for administrators / headteachers.
 * Does not expose payment amounts, student names, or full JSON payloads.
 */
export async function listOperationalAudits(
  filters: AuditListFilters,
): Promise<AuditListResult> {
  const { page, pageSize, offset } = normalizePageParams({
    page: filters.page,
    pageSize: filters.pageSize,
    defaultPageSize: 25,
    maxPageSize: Math.min(50, MAX_PAGE_SIZE),
  });
  const supabase = await createSupabaseServerClient();
  const moduleFilter = filters.module ?? "all";
  const items: AuditListItem[] = [];

  const fetchLimit = pageSize + 1;

  if (moduleFilter === "all" || moduleFilter === "academic") {
    let q = supabase
      .from("academic_event_audits")
      .select("id, event_type, actor_id, entity_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + fetchLimit - 1);
    if (filters.eventType) q = q.eq("event_type", filters.eventType);
    if (filters.actorId) q = q.eq("actor_id", filters.actorId);
    if (filters.from) q = q.gte("created_at", filters.from);
    if (filters.to) q = q.lte("created_at", filters.to);
    const { data, error } = await q;
    if (!error) {
      for (const row of data ?? []) {
        items.push({
          id: row.id,
          module: "academic",
          eventType: row.event_type,
          actorId: row.actor_id,
          resourceId: row.entity_id,
          createdAt: row.created_at,
          outcome: /fail|error|denied/i.test(row.event_type)
            ? "failure"
            : "success",
          summary: sanitizeMetadata(row.metadata),
        });
      }
    }
  }

  if (moduleFilter === "all" || moduleFilter === "finance") {
    let q = supabase
      .from("finance_event_audits")
      .select("id, event_type, actor_id, payment_id, created_at, reason")
      .order("created_at", { ascending: false })
      .range(offset, offset + fetchLimit - 1);
    if (filters.eventType) q = q.eq("event_type", filters.eventType);
    if (filters.actorId) q = q.eq("actor_id", filters.actorId);
    if (filters.from) q = q.gte("created_at", filters.from);
    if (filters.to) q = q.lte("created_at", filters.to);
    const { data, error } = await q;
    if (!error) {
      for (const row of data ?? []) {
        items.push({
          id: row.id,
          module: "finance",
          eventType: row.event_type,
          actorId: row.actor_id,
          resourceId: row.payment_id,
          createdAt: row.created_at,
          outcome: "success",
          summary: row.reason ? "reason recorded" : "—",
        });
      }
    }
  }

  if (moduleFilter === "all" || moduleFilter === "password_reset") {
    let q = supabase
      .from("password_reset_audits")
      .select(
        "id, action_type, initiated_by, target_user_id, result_status, created_at",
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + fetchLimit - 1);
    if (filters.actorId) q = q.eq("initiated_by", filters.actorId);
    if (filters.from) q = q.gte("created_at", filters.from);
    if (filters.to) q = q.lte("created_at", filters.to);
    const { data, error } = await q;
    if (!error) {
      for (const row of data ?? []) {
        const status = String(row.result_status ?? "unknown");
        if (filters.outcome === "success" && status !== "success") continue;
        if (
          filters.outcome === "failure" &&
          status !== "failure" &&
          status !== "accepted"
        ) {
          continue;
        }
        items.push({
          id: row.id,
          module: "password_reset",
          eventType: row.action_type,
          actorId: row.initiated_by,
          resourceId: row.target_user_id,
          createdAt: row.created_at,
          outcome: status === "failure" ? "failure" : "success",
          summary: `status: ${status}`,
        });
      }
    }
  }

  if (moduleFilter === "all" || moduleFilter === "report_card") {
    let q = supabase
      .from("report_card_events")
      .select("id, event_type, actor_id, report_card_id, created_at, metadata")
      .order("created_at", { ascending: false })
      .range(offset, offset + fetchLimit - 1);
    if (filters.eventType) q = q.eq("event_type", filters.eventType);
    if (filters.actorId) q = q.eq("actor_id", filters.actorId);
    if (filters.from) q = q.gte("created_at", filters.from);
    if (filters.to) q = q.lte("created_at", filters.to);
    const { data, error } = await q;
    if (!error) {
      for (const row of data ?? []) {
        items.push({
          id: row.id,
          module: "report_card",
          eventType: row.event_type,
          actorId: row.actor_id,
          resourceId: row.report_card_id,
          createdAt: row.created_at,
          outcome: /fail|error|denied|reject/i.test(row.event_type)
            ? "failure"
            : "success",
          summary: sanitizeMetadata(row.metadata),
        });
      }
    }
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const hasMore = items.length > pageSize;
  const pageItems = items.slice(0, pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    fetched: pageItems.length,
    hasMore,
  };
}
