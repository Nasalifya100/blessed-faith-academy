import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canManageExamSetup,
  canOpenExaminations,
} from "@/features/examinations/permissions";
import {
  getExamPeriod,
  listExamTemplates,
  listExamsForPeriod,
} from "@/features/examinations/queries";
import {
  CreateExamForm,
  DuplicatePeriodForm,
  ExamExclusionForm,
  PeriodStatusButtons,
  TemplateActions,
} from "@/features/examinations/components/exam-setup-forms";
import { ExamStatusActions, ExamStatusBadge } from "@/features/examinations/components/exam-status-controls";
import {
  EXAM_LIFECYCLE_STATUS_LABELS,
  EXAM_PERIOD_STATUS_LABELS,
} from "@/features/examinations/schemas";
import { StatusBadge } from "@/components/ui/status-badge";
import { listAssessmentTypes } from "@/features/academics/queries";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ExamPeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const current = await getCurrentUser();
  if (!current?.profile || !canOpenExaminations(current.profile.role)) {
    redirect("/dashboard");
  }

  const period = await getExamPeriod(id);
  if (!period) notFound();

  const canManage = canManageExamSetup(current.profile.role);
  const exams = await listExamsForPeriod(id);
  const templates = canManage ? await listExamTemplates() : [];
  const assessmentTypes = canManage ? await listAssessmentTypes() : [];

  const supabase = await createSupabaseServerClient();
  const [
    { data: subjects },
    { data: grades },
    { data: classes },
    { data: students },
  ] = canManage
    ? await Promise.all([
        supabase
          .from("subjects")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("grade_levels")
          .select("id, name")
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("classes")
          .select("id, name, grade_level_id")
          .eq("academic_year_id", period.academic_year_id)
          .order("name"),
        supabase
          .from("students")
          .select("id, first_name, last_name, admission_number")
          .eq("status", "enrolled")
          .order("last_name")
          .limit(200),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  return (
    <PageShell>
      <BackLink href="/dashboard/examinations">Examinations</BackLink>
      <PageHeader
        title={period.name}
        description={`${period.academic_year_name ?? ""}${
          period.term_name ? ` · ${period.term_name}` : ""
        } · ${EXAM_PERIOD_STATUS_LABELS[period.status]}`}
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/dashboard/examinations/periods/${id}/schedule`}
          className={cn(buttonVariants(), "h-11")}
        >
          Exam schedule
        </Link>
        <Link
          href={`/dashboard/examinations/print?period=${id}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-11")}
        >
          Print timetable
        </Link>
      </div>

      {canManage ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Status</h2>
          <PeriodStatusButtons periodId={id} status={period.status} />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Exam setup checklist</h2>
        <ul className="space-y-1 text-sm">
          <li>✓ Exam period created</li>
          <li>{exams.length > 0 ? "✓" : "○"} Subjects added ({exams.length})</li>
          <li>
            {exams.some((e) => e.schedule) ? "✓" : "○"} Dates scheduled (
            {exams.filter((e) => e.schedule).length}/{exams.length || 0})
          </li>
          <li>
            {exams.some((e) => e.schedule?.room_name) ? "✓" : "○"} Rooms assigned
          </li>
          <li>
            {exams.some((e) => e.schedule?.primary_invigilator_name) ? "✓" : "○"}{" "}
            Invigilators assigned
          </li>
          <li>
            {exams.some((e) => e.status === "READY" || e.status === "COMPLETED")
              ? "✓"
              : "○"}{" "}
            Mark exams as ready
          </li>
          <li>○ Print timetable</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Exams</h2>
        {exams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exams yet. Add subjects for each grade below.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {exams.map((exam) => (
              <li key={exam.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {exam.grade_name} {exam.subject_name}
                  </p>
                  <ExamStatusBadge status={exam.status} />
                  <StatusBadge tone="neutral">
                    Exam reference {exam.exam_reference}
                  </StatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {exam.assessment_type_name} · {exam.max_marks} marks
                  {exam.class_name ? ` · ${exam.class_name}` : " · Whole grade"}
                  {exam.schedule
                    ? ` · ${exam.schedule.exam_date} ${exam.schedule.start_time}`
                    : " · Not scheduled"}
                </p>
                {exam.instructions ? (
                  <p className="text-sm">{exam.instructions}</p>
                ) : null}
                {canManage ? (
                  <ExamStatusActions
                    examId={exam.id}
                    status={exam.status}
                    periodId={id}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {EXAM_LIFECYCLE_STATUS_LABELS[exam.status]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <>
          <section className="space-y-3 border-t pt-6">
            <h2 className="text-lg font-semibold">Add exam</h2>
            <p className="text-sm text-muted-foreground">
              Choose grade, subject, assessment type and maximum marks.
            </p>
            {(subjects ?? []).length === 0 || assessmentTypes.length === 0 ? (
              <p className="text-sm text-amber-800">
                Finish Academic setup first: add subjects and assessment types
                under Settings → Academic setup.
              </p>
            ) : (
              <CreateExamForm
                periodId={id}
                subjects={(subjects ?? []).map((s) => ({
                  id: s.id,
                  name: s.name,
                }))}
                grades={(grades ?? []).map((g) => ({
                  id: g.id,
                  name: g.name,
                }))}
                classes={(classes ?? []) as {
                  id: string;
                  name: string;
                  grade_level_id: string;
                }[]}
                assessmentTypes={assessmentTypes.map((t) => ({
                  id: t.id,
                  name: t.name,
                }))}
              />
            )}
          </section>

          <section className="space-y-3 border-t pt-6">
            <h2 className="text-lg font-semibold">Students taking this exam</h2>
            <p className="text-sm text-muted-foreground">
              Default is everyone in the selected grade or class. Exclusions stay
              collapsed unless needed.
            </p>
            <ExamExclusionForm
              exams={exams.map((exam) => ({
                id: exam.id,
                label: `${exam.grade_name} ${exam.subject_name}`,
              }))}
              students={((students ?? []) as Array<{
                id: string;
                first_name: string;
                last_name: string;
                admission_number: string | null;
              }>).map((s) => ({
                id: s.id,
                label: `${s.last_name}, ${s.first_name}${
                  s.admission_number ? ` (${s.admission_number})` : ""
                }`,
              }))}
            />
          </section>

          <section className="space-y-3 border-t pt-6">
            <h2 className="text-lg font-semibold">Templates</h2>
            <p className="text-sm text-muted-foreground">
              Optional — save this period or copy subjects from a previous
              template.
            </p>
            <TemplateActions periodId={id} templates={templates} />
          </section>

          <section className="space-y-3 border-t pt-6">
            <h2 className="text-lg font-semibold">Copy this period</h2>
            <DuplicatePeriodForm
              sourcePeriodId={id}
              sourceName={period.name}
            />
          </section>
        </>
      ) : null}
    </PageShell>
  );
}
