import Link from "next/link";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";

const MANAGER_ROLES = ["administrator", "headteacher", "secretary"];

export default async function StudentsPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  const canManage = Boolean(role && MANAGER_ROLES.includes(role));

  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("status", "enrolled");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Students</h1>
          <p className="text-muted-foreground">
            {count ?? 0} enrolled student{count === 1 ? "" : "s"}.
          </p>
        </div>
        {canManage ? (
          <Link href="/dashboard/students/new" className={buttonVariants()}>
            Add student
          </Link>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        The searchable student list and individual student profiles will appear
        here in the next step.
      </p>
    </div>
  );
}
