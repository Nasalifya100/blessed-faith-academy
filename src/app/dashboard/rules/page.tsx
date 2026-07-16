import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listSchoolRules } from "@/features/discipline/queries";
import { SchoolRulesList } from "@/features/discipline/components/school-rules-list";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VIEWER_ROLES = [
  "administrator",
  "headteacher",
  "secretary",
  "teacher",
  "bursar",
];
const EDITOR_ROLES = ["administrator", "headteacher"];

export default async function SchoolRulesPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !VIEWER_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const canEdit = EDITOR_ROLES.includes(role);
  const rules = await listSchoolRules({
    activeOnly: !canEdit,
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="School rules"
        description={
          canEdit
            ? "Edit the official rules staff and parents refer to. Inactive rules stay hidden from incident forms."
            : "Reference list of school rules. Contact the headteacher or administrator to change them."
        }
        breadcrumb={
          <BackLink href="/dashboard/discipline">Back to discipline</BackLink>
        }
        actions={
          <Link
            href="/dashboard/discipline"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Discipline cases
          </Link>
        }
      />

      <SchoolRulesList rules={rules} canEdit={canEdit} />
    </PageShell>
  );
}
