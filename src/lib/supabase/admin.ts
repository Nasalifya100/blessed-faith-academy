import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client with the SECRET service-role key.
 *
 * This client BYPASSES Row Level Security, so it must only ever run on the
 * server and only for trusted admin operations (e.g. creating staff accounts).
 * The `server-only` import above makes the build fail if this file is ever
 * imported into browser/client code.
 *
 * Every action that uses this client MUST first verify that the caller is an
 * administrator, because RLS will not do it for us here.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin environment variables. Check that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
