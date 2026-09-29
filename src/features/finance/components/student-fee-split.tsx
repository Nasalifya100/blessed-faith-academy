import { formatKwacha } from "@/lib/money";
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
}: {
  breakdown: StudentFinanceBreakdown;
}) {
  const { schoolFees, additional, additionalTotals, basis } = breakdown;
  const hasAdditional = additional.length > 0;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>School fees and additional purchases</CardTitle>
        <CardDescription>
          {basis === "allocations"
            ? "Mandatory school fees are based on how each payment has been applied to each charge. The combined student account outstanding, shown separately, also includes additional purchases."
            : "Mandatory school fees are estimated by applying payments to the oldest charges first. This is an estimate until allocations are switched on. The combined student account outstanding, shown separately, also includes additional purchases."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
