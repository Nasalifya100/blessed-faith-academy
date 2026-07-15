import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase client for use on the server (Server Components, Route
 * Handlers, and Server Actions).
 *
 * It reads and writes the auth session via cookies so that database requests
 * are made AS the currently logged-in user. This is essential for Row Level
 * Security to apply the correct permissions per user.
 *
 * Like the browser client, this uses only the public anon key. Permissions are
 * enforced by the database, not by which key is used.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Check that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // The `setAll` method was called from a Server Component. This can be
          // safely ignored when session refreshing is handled by middleware
          // (which we will add in the authentication phase).
        }
      },
    },
  });
}
