import { addKwacha, formatKwacha, sumKwacha } from "@/lib/money";
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

import type { StudentFinanceBreakdown } from "../types";

/**
 * Separates what a family owes in mandatory school fees from what they owe
 * for optional purchases such as uniforms, meals, and tuck shop.
 *
 * The two figures are shown apart on purpose: a uniform a family chose to buy
 * is not a school fee arrear, and combining them has previously made balances
 * look larger than they are.
 */
export function StudentFeeSplit({
  breakdown,
  academicYearName = null,
  currentYearOutstanding = null,
  previousOutstanding = 0,
  laterOutstanding = 0,
  undatedOutstanding = 0,
}: {
  breakdown: StudentFinanceBreakdown;
  academicYearName?: string | null;
  currentYearOutstanding?: number | null;
  previousOutstanding?: number;
  laterOutstanding?: number;
  undatedOutstanding?: number;
}) {
  const { schoolFees, additional, additionalTotals, basis } = breakdown;
  const hasAdditional = additional.length > 0;
  const combinedOutstanding = addKwacha(
    schoolFees.outstanding,
    additionalTotals.outstanding,
  );
  const uniformsOutstanding =
    additional.find((row) => row.code === "UNIFORMS")?.outstanding ?? 0;
  const mealsOutstanding =
    additional.find((row) => row.code === "MEALS")?.outstanding ?? 0;
  const otherOutstanding = sumKwacha(
    additional
      .filter((row) => row.code !== "UNIFORMS" && row.code !== "MEALS")
      .map((row) => row.outstanding),
  );
  const breakdownRows = [
    { label: "School Fees", amount: schoolFees.outstanding, hint: "Mandatory" },
    { label: "Uniforms", amount: uniformsOutstanding, hint: "Only if charged" },
    { label: "Meals", amount: mealsOutstanding, hint: "Only if charged" },
    { label: "Other", amount: otherOutstanding, hint: "" },
  ];
  const showPrevious = previousOutstanding > 0;
  const showLater = laterOutstanding > 0;
  const showUndated = undatedOutstanding > 0;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Student finance</CardTitle>
        <CardDescription>
          {basis === "allocations"
            ? "Oldest outstanding charges are paid first. These figures follow the stored payment allocations."
            : "Oldest outstanding charges are paid first. This breakdown is an estimate and is not stored as fund income."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2" aria-label="Combined student account">
          <h3 className="text-sm font-semibold">Combined outstanding</h3>
          <p
            className={
              combinedOutstanding > 0
                ? "text-2xl font-semibold tabular-nums text-red-700 dark:text-red-300"
                : "text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
            }
          >
            {formatKwacha(combinedOutstanding)}
          </p>
          <p className="text-xs text-muted-foreground">
            Mandatory school fees plus uniforms, meals, and other pupil charges.
            School Fees below are not the whole account.
          </p>
        </section>

        <section className="space-y-2" aria-label="Activity breakdown">
          <h3 className="text-sm font-semibold">Breakdown</h3>
          <ul className="divide-y rounded-xl border">
            {breakdownRows.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span>
                  {row.label}
                  {row.hint ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.hint}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums font-medium">
                  {formatKwacha(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {currentYearOutstanding != null ? (
          <section className="space-y-2" aria-label="Academic year outstanding">
            <h3 className="text-sm font-semibold">
              Current academic year
              {academicYearName ? ` — ${academicYearName}` : ""}
            </h3>
            <p className="text-lg font-semibold tabular-nums">
              {formatKwacha(currentYearOutstanding)}
            </p>
            {showPrevious ? (
              <div className="space-y-1 text-sm">
                <p className="flex justify-between gap-3">
                  <span>Previous outstanding</span>
                  <span className="tabular-nums font-medium">
                    {formatKwacha(previousOutstanding)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Previous debt stays on its original academic year.
                </p>
              </div>
            ) : null}
            {showUndated ? (
              <p className="flex justify-between gap-3 text-sm">
                <span>Other academic year</span>
                <span className="tabular-nums font-medium">
                  {formatKwacha(undatedOutstanding)}
                </span>
              </p>
            ) : null}
            {showLater ? (
              <div className="space-y-1 text-sm">
                <p className="flex justify-between gap-3">
                  <span>Later academic year</span>
                  <span className="tabular-nums font-medium">
                    {formatKwacha(laterOutstanding)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  This is not previous debt. It belongs to a year that starts
                  after the current year.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-2" aria-label="Mandatory school fees">
          <h3 className="text-sm font-semibold">Mandatory school fees</h3>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">Charged</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwacha(schoolFees.charged)}
              </dd>
            </div>
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwacha(schoolFees.paid)}
              </dd>
            </div>
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">Outstanding</dt>
              <dd
                className={
                  schoolFees.outstanding > 0
                    ? "text-lg font-semibold tabular-nums text-red-700 dark:text-red-300"
                    : "text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
                }
              >
                {formatKwacha(schoolFees.outstanding)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Tuition and other compulsory charges only. Uniforms, meals, and
            tuck shop purchases are listed separately below and are not part of
            this figure.
          </p>
        </section>

        <section className="space-y-2" aria-label="Additional purchases">
          <h3 className="text-sm font-semibold">Additional purchases</h3>
          {hasAdditional ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {additional.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(row.charged)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(row.paid)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(row.outstanding)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatKwacha(additionalTotals.charged)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatKwacha(additionalTotals.paid)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatKwacha(additionalTotals.outstanding)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No optional purchases for this pupil.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
