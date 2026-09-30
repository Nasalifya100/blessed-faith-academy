import { formatKwacha } from "@/lib/money";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface BillingPeriodRow {
  yearId: string;
  yearName: string;
  isYearCharge: boolean;
  termName: string;
  outstanding: number;
}

export function StudentBillingPeriods({
  basis,
  academicYearName,
  currentYearOutstanding,
  previousOutstanding,
  laterOutstanding = 0,
  undatedOutstanding = 0,
  periods,
}: {
  basis: "allocations" | "fifo_estimate";
  academicYearName: string | null;
  currentYearOutstanding: number;
  previousOutstanding: number;
  laterOutstanding?: number;
  undatedOutstanding?: number;
  periods: BillingPeriodRow[];
}) {
  if (periods.length === 0) return null;

  const years: Array<{ yearId: string; yearName: string; rows: BillingPeriodRow[] }> =
    [];
  for (const period of periods) {
    const existing = years.find((year) => year.yearId === period.yearId);
    if (existing) {
      existing.rows.push(period);
    } else {
      years.push({
        yearId: period.yearId,
        yearName: period.yearName,
        rows: [period],
      });
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Billing periods</CardTitle>
        <CardDescription>
          Oldest outstanding charges are paid first.
          {basis === "allocations"
            ? " Amounts follow stored payment allocations."
            : " These amounts are an estimate and are not stored as fund income."}
          {academicYearName ? ` Current academic year: ${academicYearName}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-3">
            <dt className="text-xs text-muted-foreground">
              Current academic year
              {academicYearName ? ` — ${academicYearName}` : ""}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatKwacha(currentYearOutstanding)}
            </dd>
          </div>
          {previousOutstanding > 0 ? (
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">
                Previous outstanding
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwacha(previousOutstanding)}
              </dd>
            </div>
          ) : null}
          {laterOutstanding > 0 ? (
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">
                Later academic year
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwacha(laterOutstanding)}
              </dd>
            </div>
          ) : null}
          {undatedOutstanding > 0 ? (
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">
                Other academic year
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwacha(undatedOutstanding)}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="space-y-3">
          {years.map((year) => (
            <section key={year.yearId} className="rounded-xl border">
              <h3 className="border-b px-3 py-2 text-sm font-semibold">
                {year.yearName}
              </h3>
              <ul>
                {year.rows.map((period) => (
                  <li
                    key={`${period.yearId}-${period.isYearCharge ? "year" : period.termName}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span>{period.termName}</span>
                    <span className="tabular-nums font-medium">
                      {formatKwacha(period.outstanding)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
