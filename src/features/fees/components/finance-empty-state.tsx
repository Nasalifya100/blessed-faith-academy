import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";

/** @deprecated Prefer EmptyState from @/components/ui/empty-state */
export function FinanceEmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={action}
      icon={icon}
      size="md"
    />
  );
}
