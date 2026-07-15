import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withRetry } from "@/lib/retry";
import type { Profile } from "@/features/auth/types";

export interface CurrentUser {
  id: string;
  email: string | null;
  profile: Profile | null;
  /**
   * True when we have a valid session but could not load the profile row
   * (usually a network/connection problem). Lets callers tell "no profile"
   * apart from "failed to check", so we don't wrongly report "not authorized".
   */
  profileLoadFailed: boolean;
}

/**
 * Returns the logged-in user and their staff profile, or null if not logged in.
 *
 * Uses getClaims() to read/verify the session (locally when possible), then
 * fetches the profile row. Both steps are retried a few times so a brief
 * network blip on a slow connection does not fail the whole request. Wrapped
 * in React's `cache` so multiple calls within the same server render run once.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();

  let claims: Record<string, unknown> | null = null;
  try {
    const { data } = await withRetry(() => supabase.auth.getClaims());
    claims = (data?.claims as Record<string, unknown> | undefined) ?? null;
  } catch {
    // Could not verify the session (e.g. network timeout). Treat as no session
    // rather than crashing; the user will be sent to the login page.
    return null;
  }

  const sub = typeof claims?.sub === "string" ? claims.sub : null;
  if (!sub) {
    return null;
  }

  const email = typeof claims?.email === "string" ? claims.email : null;

  let profile: Profile | null = null;
  let profileLoadFailed = false;
  try {
    profile = await withRetry(async () => {
      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("id, school_id, full_name, role, phone, is_active")
        .eq("id", sub)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return (profileData as Profile | null) ?? null;
    });
  } catch {
    profileLoadFailed = true;
  }

  return {
    id: sub,
    email,
    profile,
    profileLoadFailed,
  };
});
