import { operationalActivity } from "@/features/finance/presentation";
import { OperationalActivityPage } from "@/features/finance/components/operational-activity-page";

const activity = operationalActivity("MEALS");

export default function MealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!activity) return null;
  return (
    <OperationalActivityPage activity={activity} searchParams={searchParams} />
  );
}
