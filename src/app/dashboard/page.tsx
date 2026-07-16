import { Suspense } from "react";

import { DashboardHome } from "@/features/dashboard/components/dashboard-home";
import { DashboardHomeSkeleton } from "@/features/dashboard/components/dashboard-home-skeleton";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardHomeSkeleton />}>
      <DashboardHome />
    </Suspense>
  );
}
