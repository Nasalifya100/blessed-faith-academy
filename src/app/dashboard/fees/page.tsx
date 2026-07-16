import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getFeesSetupData } from "@/features/fees/queries";
import { getFeeBalancesReport } from "@/features/reports/queries";
import { getCurrentYearClasses } from "@/features/students/queries";
import {
  BILLING_FREQUENCY_LABELS,
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  REQUIREMENT_BAND_LABELS,
} from "@/features/fees/schemas";
import { ScheduleAmountEditor } from "@/features/fees/components/schedule-amount-editor";
import { GenerateClassChargesPanel } from "@/features/fees/components/generate-class-charges-panel";
import { FinanceDashboardSummary } from "@/features/fees/components/finance-dashboard-summary";
import { SetCurrentPeriodPanel } from "@/features/config/components/set-current-period-panel";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import {
  PageHeader,
  PageShell,
  SectionHeading,
  BackLink,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FEE_MANAGER_ROLES = ["administrator", "bursar", "headteacher"];
const FEE_VIEWER_ROLES = [
  "administrator",
  "bursar",
  "headteacher",
  "secretary",
];

function FeesPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

async function FeesDashboardBody({
  canEdit,
  isAdmin,
}: {
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [
    { academicYearName, currentTermId, currentTermName, items, requirements },
    yearClasses,
    periodOptions,
    balances,
  ] = await Promise.all([
    getFeesSetupData(),
    getCurrentYearClasses(),
    isAdmin
      ? listAcademicYearsAndTerms()
      : Promise.resolve({ years: [], terms: [] }),
    getFeeBalancesReport({ outstandingOnly: false }),
  ]);

  const requirementsByBand = new Map<string, typeof requirements>();
  for (const item of requirements) {
    const list = requirementsByBand.get(item.band) ?? [];
    list.push(item);
    requirementsByBand.set(item.band, list);
  }

  return (
    <>
      <FinanceDashboardSummary
        balances={balances}
        termName={currentTermName}
        canEdit={canEdit}
      />

      {isAdmin ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Current year &amp; term</CardTitle>
            <CardDescription>
              Switch the school&apos;s active academic period (one current year
              and one current term).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SetCurrentPeriodPanel
              years={periodOptions.years}
              terms={periodOptions.terms}
            />
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Card id="generate-charges" className="scroll-mt-6 shadow-sm">
          <CardHeader>
            <CardTitle>Generate class charges</CardTitle>
            <CardDescription>
              Apply mandatory fees for every enrolled pupil in a class for the
              current term
              {currentTermName ? ` (${currentTermName})` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GenerateClassChargesPanel
              classes={yearClasses.classes}
              termId={currentTermId}
              termName={currentTermName}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        <SectionHeading
          title="Fee schedule"
          description={
            <>
              Catalogue for
              {academicYearName
                ? ` academic year ${academicYearName}`
                : " the current academic year"}
              {canEdit
                ? ". Click an amount to edit it."
                : ". View only — contact an administrator or bursar to change amounts."}
            </>
          }
        />
      </div>

      {FEE_CATEGORIES.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;

        return (
          <Card key={category} className="shadow-sm">
            <CardHeader>
              <CardTitle>{FEE_CATEGORY_LABELS[category]}</CardTitle>
              <CardDescription>
                {category === "tuition"
                  ? "Charged per term according to the child's grade."
                  : category === "meal" || category === "uniform"
                    ? "Optional — only charged when a family opts in."
                    : "Charged for every enrolled pupil (report book, PTA, maintenance)."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {categoryItems.map((item) => (
                <div key={item.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{item.name}</h3>
                    <StatusBadge tone="neutral">
                      {BILLING_FREQUENCY_LABELS[item.billingFrequency] ??
                        item.billingFrequency}
                    </StatusBadge>
                    {item.isOptional ? (
                      <StatusBadge tone="info">Optional</StatusBadge>
                    ) : null}
                  </div>

                  {item.schedules.length === 0 ? (
                    <EmptyState
                      title="No amount set for this year yet"
                      size="sm"
                    />
                  ) : (
                    <div className="overflow-hidden rounded-xl border">
                      <div className="relative max-h-80 overflow-auto">
                        <Table>
                          <TableHeader className={stickyHeaderClass}>
                            <TableRow>
                              <TableHead>Applies to</TableHead>
                              <TableHead className="text-right">
                                Amount
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {item.schedules.map((schedule) => (
                              <TableRow
                                key={schedule.id}
                                className="transition-colors hover:bg-muted/40"
                              >
                                <TableCell>
                                  {schedule.gradeLevelName ?? "All grades"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <ScheduleAmountEditor
                                    scheduleId={schedule.id}
                                    initialAmount={schedule.amount}
                                    canEdit={canEdit}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Requirements checklist</CardTitle>
          <CardDescription>
            Items parents must bring. These are not billed as money.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {["preschool", "lower", "upper"].map((band) => {
            const bandItems = requirementsByBand.get(band) ?? [];
            if (bandItems.length === 0) return null;
            return (
              <div key={band} className="space-y-2">
                <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  {REQUIREMENT_BAND_LABELS[band] ?? band}
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {bandItems.map((item) => (
                    <li key={item.id}>
                      {item.quantity ? `${item.quantity}× ` : ""}
                      {item.name}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Need a printable balances list?{" "}
        <Link
          href="/dashboard/reports/fee-balances"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Open fee balances report
        </Link>
      </p>
    </>
  );
}

export default async function FeesPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !FEE_VIEWER_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const canEdit = FEE_MANAGER_ROLES.includes(role);
  const isAdmin = role === "administrator";

  return (
    <PageShell className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Fees & payments"
        description="Overview of outstanding balances, collections, and the fee catalogue."
        breadcrumb={<BackLink href="/dashboard">Back to dashboard</BackLink>}
      />

      <Suspense fallback={<FeesPageSkeleton />}>
        <FeesDashboardBody canEdit={canEdit} isAdmin={isAdmin} />
      </Suspense>
    </PageShell>
  );
}
