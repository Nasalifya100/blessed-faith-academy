import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { getFeesSetupData } from "@/features/fees/queries";
import { getCurrentYearClasses } from "@/features/students/queries";
import {
  BILLING_FREQUENCY_LABELS,
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  REQUIREMENT_BAND_LABELS,
} from "@/features/fees/schemas";
import { ScheduleAmountEditor } from "@/features/fees/components/schedule-amount-editor";
import { GenerateClassChargesPanel } from "@/features/fees/components/generate-class-charges-panel";
import { SetCurrentPeriodPanel } from "@/features/config/components/set-current-period-panel";
import { listAcademicYearsAndTerms } from "@/features/config/queries";
import { Badge } from "@/components/ui/badge";
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

export default async function FeesPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;

  if (!role || !FEE_VIEWER_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const canEdit = FEE_MANAGER_ROLES.includes(role);
  const isAdmin = role === "administrator";
  const [
    { academicYearName, currentTermId, currentTermName, items, requirements },
    yearClasses,
    periodOptions,
  ] = await Promise.all([
    getFeesSetupData(),
    getCurrentYearClasses(),
    isAdmin
      ? listAcademicYearsAndTerms()
      : Promise.resolve({ years: [], terms: [] }),
  ]);

  const requirementsByBand = new Map<string, typeof requirements>();
  for (const item of requirements) {
    const list = requirementsByBand.get(item.band) ?? [];
    list.push(item);
    requirementsByBand.set(item.band, list);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Fees &amp; requirements</h1>
        <p className="text-muted-foreground">
          Fee schedule for
          {academicYearName ? ` academic year ${academicYearName}` : " the current academic year"}
          {canEdit
            ? ". Click an amount to edit it."
            : ". View only — contact an administrator or bursar to change amounts or record payments."}
        </p>
      </div>

      {isAdmin ? (
        <Card>
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
        <Card>
          <CardHeader>
            <CardTitle>Generate class charges</CardTitle>
            <CardDescription>
              Apply mandatory fees for every enrolled pupil in a class for the
              current term.
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

      {FEE_CATEGORIES.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;

        return (
          <Card key={category}>
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
                    <Badge variant="outline">
                      {BILLING_FREQUENCY_LABELS[item.billingFrequency] ??
                        item.billingFrequency}
                    </Badge>
                    {item.isOptional ? (
                      <Badge variant="secondary">Optional</Badge>
                    ) : null}
                  </div>

                  {item.schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No amount set for this year yet.
                    </p>
                  ) : (
                    <div className="rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Applies to</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
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
                                  canEdit={canEdit}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
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
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
    </div>
  );
}
