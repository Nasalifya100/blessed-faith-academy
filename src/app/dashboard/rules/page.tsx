import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { listSchoolRules } from "@/features/discipline/queries";
import { SchoolRulesList } from "@/features/discipline/components/school-rules-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">School rules</h1>
        <p className="text-muted-foreground">
          {canEdit
            ? "Edit the official rules staff and parents refer to. Inactive rules stay hidden from incident forms."
            : "Reference list of school rules. Contact the headteacher or administrator to change them."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>
            {rules.length} rule{rules.length === 1 ? "" : "s"}
            {canEdit ? "" : " (active only)"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchoolRulesList rules={rules} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
