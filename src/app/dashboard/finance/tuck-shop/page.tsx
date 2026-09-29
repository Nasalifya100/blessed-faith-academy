import { operationalActivity } from "@/features/finance/presentation";
import { OperationalActivityPage } from "@/features/finance/components/operational-activity-page";

const activity = operationalActivity("TUCK_SHOP");

export default function TuckShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!activity) return null;
  return (
    <OperationalActivityPage activity={activity} searchParams={searchParams} />
  );
}
