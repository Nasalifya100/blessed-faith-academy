import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/features/auth/types";

export interface CurrentUser {
  id: string;
  email: string | null;
  profile: Profile | null;
}

/**
 * Returns the logged-in user and their staff profile, or null if not logged in.
 *
 * Uses getClaims() to read/verify the session (locally when possible), then
 * fetches the profile row. Wrapped in React's `cache` so multiple calls within
 * the same server render only run once.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    return null;
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, school_id, full_name, role, phone, is_active")
    .eq("id", claims.sub)
    .maybeSingle();

  const email = typeof claims.email === "string" ? claims.email : null;

  return {
    id: claims.sub,
    email,
    profile: (profileData as Profile | null) ?? null,
  };
});
