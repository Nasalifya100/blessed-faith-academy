import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  Layers,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { isProductionResetEnvEnabled } from "@/features/auth/permissions";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import { SetCurrentPeriodPanel } from "@/features/config/components/set-current-period-panel";
import { getFeesSetupData } from "@/features/fees/queries";
import { getCurrentYearClasses } from "@/features/students/queries";
import { listStaffWithEmails } from "@/features/staff/queries";
import { listSchoolRules } from "@/features/discipline/queries";
import { ScheduleAmountEditor } from "@/features/fees/components/schedule-amount-editor";
import {
  BILLING_FREQUENCY_LABELS,
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  REQUIREMENT_BAND_LABELS,
} from "@/features/fees/schemas";
import {
  BackLink,
  PageHeader,
  PageShell,
  SectionHeading,
} from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { stickyHeaderClass } from "@/components/ui/admin-chrome";
import { buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

const SECTION_LINKS = [
  { href: "#school-information", label: "School" },
  { href: "#academic-period", label: "Years & terms" },
  { href: "/dashboard/settings/academics", label: "Academic setup" },
  { href: "#grades", label: "Grades" },
  { href: "#classes", label: "Classes" },
  { href: "#fee-configuration", label: "Fees" },
  { href: "#requirements", label: "Requirements" },
  { href: "#school-rules", label: "Rules" },
] as const;

export default async function SettingsPage() {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "administrator") {
    redirect("/dashboard");
  }

  const [period, fees, yearClasses, staff, rules] = await Promise.all([
    listAcademicYearsAndTerms(),
    getFeesSetupData(),
    getCurrentYearClasses(),
    listStaffWithEmails(),
    listSchoolRules({ activeOnly: false }),
  ]);

  const currentYear =
    period.years.find((y) => y.isCurrent)?.name ??
    fees.academicYearName ??
    "—";
  const currentTerm =
    period.terms.find((t) => t.isCurrent)?.name ??
    fees.currentTermName ??
    "—";

  const gradeMap = new Map<string, number>();
  for (const cls of yearClasses.classes) {
    gradeMap.set(cls.gradeName, (gradeMap.get(cls.gradeName) ?? 0) + 1);
  }
  const grades = [...gradeMap.entries()].map(([name, classCount]) => ({
    name,
    classCount,
  }));

  const activeStaff = staff.filter((m) => m.is_active).length;
  const feeStructures = fees.items.length;
  const activeRules = rules.filter((r) => r.isActive).length;
  const resetEnabled = isProductionResetEnvEnabled();

  const requirementsByBand = new Map<string, typeof fees.requirements>();
  for (const item of fees.requirements) {
    const list = requirementsByBand.get(item.band) ?? [];
    list.push(item);
    requirementsByBand.set(item.band, list);
  }

  return (
    <PageShell className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="School configuration for Blessed Faith Academy — academic period, structure, fees, and rules."
        breadcrumb={<BackLink href="/dashboard">Back to dashboard</BackLink>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Academic year"
          value={currentYear}
          hint="Marked current"
          icon={CalendarDays}
          tone="info"
        />
        <StatCard
          title="Current term"
          value={currentTerm}
          hint="Active billing term"
          icon={CalendarDays}
          tone="success"
        />
        <StatCard
          title="Grades"
          value={String(grades.length)}
          hint="From current-year classes"
          icon={Layers}
        />
        <StatCard
          title="Classes"
          value={String(yearClasses.classes.length)}
          hint="Active this year"
          icon={Building2}
          tone="info"
        />
        <StatCard
          title="Fee structures"
          value={String(feeStructures)}
          hint="Active fee catalogue items"
          icon={Wallet}
          tone="warning"
        />
        <StatCard
          title="Active staff"
          value={String(activeStaff)}
          hint={`${staff.length} total accounts`}
          icon={Users}
          tone="success"
          href="/dashboard/staff"
        />
      </div>

      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-2 rounded-xl border bg-card p-3 shadow-sm"
      >
        {SECTION_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "min-h-10",
            )}
          >
            {link.label}
          </a>
        ))}
      </nav>

      <Card id="system-preparation" className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
            System Preparation
          </CardTitle>
          <CardDescription>
            Tools for preparing this project for real school data. Destructive
            controls stay disabled until explicitly unlocked on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Finance migration readiness</p>
              <p className="max-w-xl text-sm text-muted-foreground">
                Administrator-only checklist for Phase 2 payment allocations.
                Read-only — does not activate, backfill, or change payments.
              </p>
            </div>
            <Link
              href="/dashboard/settings/finance-migration"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11 shrink-0",
              )}
            >
              Open finance migration status
            </Link>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Production Reset</p>
              <p className="max-w-xl text-sm text-muted-foreground">
                Permanently remove test operational data while preserving staff,
                authentication, academic setup, and fee configuration.
              </p>
              {!resetEnabled ? (
                <p className="text-xs text-muted-foreground">
                  Reset unavailable —{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    ALLOW_PRODUCTION_RESET
                  </code>{" "}
                  is not enabled.
                </p>
              ) : (
                <StatusBadge tone="warning">Reset unlocked</StatusBadge>
              )}
            </div>
            <Link
              href="/dashboard/settings/production-reset"
              className={cn(
                buttonVariants({
                  variant: resetEnabled ? "destructive" : "outline",
                }),
                "min-h-11 shrink-0",
              )}
            >
              Open Production Reset
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card id="school-information" className="scroll-mt-6 shadow-sm">
        <CardHeader>
          <CardTitle>School information</CardTitle>
          <CardDescription>
            Display identity used across the system. Detailed school profile
            fields are not editable in this screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">School name</dt>
              <dd className="font-medium">Blessed Faith Academy</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Country</dt>
              <dd className="font-medium">Zambia</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Current year</dt>
              <dd className="font-medium">{currentYear}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Current term</dt>
              <dd className="font-medium">{currentTerm}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card id="academic-period" className="scroll-mt-6 shadow-sm">
        <CardHeader>
          <CardTitle>Academic years &amp; terms</CardTitle>
          <CardDescription>
            Switch the school&apos;s active academic period. Changes affect
            enrolment, attendance, and fee schedules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetCurrentPeriodPanel
            years={period.years}
            terms={period.terms}
            showDirectory
          />
        </CardContent>
      </Card>

      <Card id="grades" className="scroll-mt-6 shadow-sm">
        <CardHeader>
          <CardTitle>Grades</CardTitle>
          <CardDescription>
            Grades inferred from active classes in the current academic year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {grades.length === 0 ? (
            <EmptyState
              title="No grades"
              description="No active classes are set for the current year, so grades cannot be listed yet."
              size="sm"
              icon={
                <Layers className="size-6 text-muted-foreground" aria-hidden />
              }
            />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-xl border md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead>Grade</TableHead>
                      <TableHead className="text-right">Classes</TableHead>
                      <TableHead className="text-right">Students</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grades.map((grade) => (
                      <TableRow key={grade.name}>
                        <TableCell className="font-medium">
                          {grade.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {grade.classCount}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          —
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone="success">Active</StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
                {grades.map((grade) => (
                  <li
                    key={grade.name}
                    className="space-y-2 rounded-xl border p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{grade.name}</p>
                      <StatusBadge tone="success">Active</StatusBadge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {grade.classCount} class
                      {grade.classCount === 1 ? "" : "es"} · Students not in
                      this load
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="classes" className="scroll-mt-6 shadow-sm">
        <CardHeader>
          <CardTitle>Classes</CardTitle>
          <CardDescription>
            Active classes for{" "}
            {yearClasses.academicYearName ?? "the current year"}. Teacher,
            capacity, and enrolment counts are not in this dataset.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {yearClasses.classes.length === 0 ? (
            <EmptyState
              title="No classes"
              description="No active classes found for the current academic year."
              size="sm"
              icon={
                <Building2
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              }
            />
          ) : (
            <>
              <div className="hidden max-h-[min(60vh,28rem)] overflow-auto rounded-xl border md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead>Class</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Teacher</TableHead>
                      <TableHead className="text-right">Capacity</TableHead>
                      <TableHead className="text-right">Students</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearClasses.classes.map((cls) => (
                      <TableRow key={cls.id}>
                        <TableCell className="font-medium">
                          {cls.name}
                        </TableCell>
                        <TableCell>{cls.gradeName}</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          —
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          —
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone="success">Active</StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="space-y-3 md:hidden">
                {yearClasses.classes.map((cls) => (
                  <li
                    key={cls.id}
                    className="space-y-2 rounded-xl border p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{cls.gradeName}</p>
                      <StatusBadge tone="success">Active</StatusBadge>
                    </div>
                    <p className="text-sm text-muted-foreground">{cls.name}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <section id="fee-configuration" className="scroll-mt-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            title="Fee configuration"
            description={
              <>
                Catalogue for
                {fees.academicYearName
                  ? ` academic year ${fees.academicYearName}`
                  : " the current academic year"}
                . Click an amount to edit.
              </>
            }
          />
          <Link
            href="/dashboard/fees"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}
          >
            Open Fees workspace
          </Link>
        </div>

        {fees.items.length === 0 ? (
          <EmptyState
            title="No fee structures"
            description="No active fee items are configured yet."
            icon={
              <Wallet className="size-6 text-muted-foreground" aria-hidden />
            }
          />
        ) : (
          FEE_CATEGORIES.map((category) => {
            const categoryItems = fees.items.filter(
              (item) => item.category === category,
            );
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
                        : "Charged for every enrolled pupil."}
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
                          <div className="relative max-h-72 overflow-auto">
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
                                  <TableRow key={schedule.id}>
                                    <TableCell>
                                      {schedule.gradeLevelName ?? "All grades"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <ScheduleAmountEditor
                                        scheduleId={schedule.id}
                                        initialAmount={schedule.amount}
                                        canEdit
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
          })
        )}
      </section>

      <Card id="requirements" className="scroll-mt-6 shadow-sm">
        <CardHeader>
          <CardTitle>Requirements</CardTitle>
          <CardDescription>
            Items parents must bring. These are not billed as money.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {fees.requirements.length === 0 ? (
            <EmptyState
              title="No requirements"
              description="No checklist items are configured yet."
              size="sm"
              icon={
                <ClipboardList
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              }
            />
          ) : (
            ["preschool", "lower", "upper"].map((band) => {
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
            })
          )}
        </CardContent>
      </Card>

      <Card id="school-rules" className="scroll-mt-6 shadow-sm">
        <CardHeader>
          <CardTitle>School rules</CardTitle>
          <CardDescription>
            Official behaviour rules used when recording discipline incidents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone="success">
              {activeRules} active
            </StatusBadge>
            <StatusBadge tone="neutral">
              {rules.length - activeRules} inactive
            </StatusBadge>
          </div>
          {rules.length === 0 ? (
            <EmptyState
              title="No rules configured"
              description="Add school rules so staff can link incidents to the handbook."
              size="sm"
              icon={
                <BookOpen
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              }
            />
          ) : (
            <ul className="space-y-2">
              {rules.slice(0, 5).map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5"
                >
                  <span className="font-medium">
                    #{rule.sortOrder} {rule.title}
                  </span>
                  {rule.isActive ? (
                    <StatusBadge tone="success">Active</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Inactive</StatusBadge>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/rules"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}
          >
            Manage school rules
          </Link>
        </CardContent>
      </Card>
    </PageShell>
  );
}
