import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canManageExamSetup } from "@/features/examinations/permissions";
import { ExamPeriodForm } from "@/features/examinations/components/exam-setup-forms";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewExamPeriodPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canManageExamSetup(current.profile.role)) {
    redirect("/dashboard/examinations");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: years }, { data: terms }] = await Promise.all([
    supabase
      .from("academic_years")
      .select("id, name, is_current")
      .order("start_date", { ascending: false }),
    supabase
      .from("terms")
      .select("id, name, academic_year_id")
      .order("term_number"),
  ]);

  const yearOptions = (years ?? []).map((y) => ({ id: y.id, name: y.name }));
  const currentYear = (years ?? []).find((y) => y.is_current);

  return (
    <PageShell>
      <BackLink href="/dashboard/examinations">Examinations</BackLink>
      <PageHeader
        title="Create exam period"
        description="Step 1 — name the sitting window (Mid-Term, End of Term, Mock…)."
      />
      <ExamPeriodForm
        years={yearOptions}
        terms={(terms ?? []) as { id: string; name: string; academic_year_id: string }[]}
        defaults={{
          academic_year_id: currentYear?.id,
          status: "DRAFT",
        }}
      />
    </PageShell>
  );
}
