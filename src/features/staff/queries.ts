import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/features/auth/queries/current-user";
import type { Profile } from "@/features/auth/types";

export interface StaffMember extends Profile {
  email: string | null;
}

/**
 * Lists all staff (profile + login email) for the administrator's school.
 *
 * Returns an empty list for non-administrators. Profiles are read with the
 * normal (RLS-protected) client; login emails live in auth.users and are read
 * with the admin client, which is safe here because we verify the caller is an
 * administrator first.
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

  const admin = createSupabaseAdminClient();
  const { data: usersData } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  const emailById = new Map<string, string | null>();
  for (const user of usersData?.users ?? []) {
    emailById.set(user.id, user.email ?? null);
  }

  return ((profiles as Profile[] | null) ?? []).map((profile) => ({
    ...profile,
    email: emailById.get(profile.id) ?? null,
  }));
}
