import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import type { Profile } from "@/features/auth/types";

export interface StaffMember extends Profile {
  email: string | null;
}

const EMAIL_LOOKUP_CHUNK = 25;

/**
 * Fetch Auth emails only for the given profile IDs (no project-wide user dump).
 */
async function emailsForProfileIds(
  ids: string[],
): Promise<Map<string, string | null>> {
  const emailById = new Map<string, string | null>();
  if (ids.length === 0) {
    return emailById;
  }

  const admin = createSupabaseAdminClient();

  for (let i = 0; i < ids.length; i += EMAIL_LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + EMAIL_LOOKUP_CHUNK);
    const results = await Promise.all(
      chunk.map(async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error || !data.user) {
          return [id, null] as const;
        }
        return [id, data.user.email ?? null] as const;
      }),
    );
    for (const [id, email] of results) {
      emailById.set(id, email);
    }
  }

  return emailById;
}

/**
 * Lists all staff (profile + login email) for the administrator's school.
 *
 * Returns an empty list for non-administrators. Profiles are read with the
 * normal (RLS-protected) client; login emails live in auth.users and are read
 * with the admin client, which is safe here because we verify the caller is an
 * administrator first. Only known profile IDs are looked up (not all Auth users).
 */
export async function listStaffWithEmails(): Promise<StaffMember[]> {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "administrator") {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, school_id, full_name, role, phone, is_active")
    .order("full_name", { ascending: true });

  const list = (profiles as Profile[] | null) ?? [];
  const emailById = await emailsForProfileIds(list.map((profile) => profile.id));

  return list.map((profile) => ({
    ...profile,
    email: emailById.get(profile.id) ?? null,
  }));
}
