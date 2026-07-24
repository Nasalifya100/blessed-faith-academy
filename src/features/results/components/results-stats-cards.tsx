import type { StatisticsSummary } from "@/features/results/types";

export function ResultsStatsCards({ stats }: { stats: StatisticsSummary | null }) {
  if (!stats) {
    return (
      <p className="text-sm text-muted-foreground">
        No statistics yet. Recalculate after gradebooks are submitted.
      </p>
    );
  }

  const cards = [
    { label: "Class average", value: formatPct(stats.average) },
    { label: "Highest", value: formatPct(stats.highest) },
    { label: "Lowest", value: formatPct(stats.lowest) },
    { label: "Median", value: formatPct(stats.median) },
    { label: "Pass rate", value: formatPct(stats.pass_rate) },
    { label: "Students", value: String(stats.count) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border bg-muted/20 px-4 py-3"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {card.label}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{card.value}</p>
        </div>
      ))}
    </div>
  );
}

function formatPct(value: number | null): string {
  if (value == null) return "—";
  return `${value}%`;
}
