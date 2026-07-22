import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canViewFinanceMigrationStatus } from "@/features/auth/permissions";
import {
  parseFinanceAllocationMigrationStatus,
  unavailableFinanceAllocationMigrationStatus,
  type FinanceAllocationMigrationStatus,
} from "@/features/fees/migration-status";

export type { FinanceAllocationMigrationStatus };

export async function getFinanceAllocationMigrationStatus(): Promise<{
  allowed: boolean;
  status: FinanceAllocationMigrationStatus | null;
  error: string | null;
}> {
  const current = await getCurrentUser();
  if (!canViewFinanceMigrationStatus(current?.profile?.role)) {
    return { allowed: false, status: null, error: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "get_finance_allocation_migration_status",
  );

  if (error) {
    // Migration not applied yet — report unavailable checker, still Legacy mode.
    const missing =
      /function|does not exist|schema cache/i.test(error.message) ||
      error.code === "PGRST202" ||
      error.code === "42883";

    if (missing) {
      return {
        allowed: true,
        status: unavailableFinanceAllocationMigrationStatus(),
        error: null,
      };
    }

    return {
      allowed: true,
      status: null,
      error: "Could not load finance migration status.",
    };
  }

  return {
    allowed: true,
    status: parseFinanceAllocationMigrationStatus(data, {
      statusCheckerAvailable: true,
    }),
    error: null,
  };
}
