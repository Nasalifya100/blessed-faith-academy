import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Auth session gate (Edge middleware).
 *
 * Next.js 16 prefers `proxy.ts`, but that is Node-only and
 * `@opennextjs/cloudflare` does not support Node middleware yet.
 * Keep the legacy `middleware.ts` convention for Workers builds.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all request paths EXCEPT:
     * - Next.js internals (_next/static, _next/image)
     * - the favicon and common static image files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
