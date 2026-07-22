import { History } from "lucide-react";

import type { ProfileChangeHistoryEntry } from "@/features/students/profile-change-queries";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProfileChangeHistoryPanel({
  entries,
  errorMessage,
}: {
  entries: ProfileChangeHistoryEntry[];
  errorMessage?: string | null;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Profile Change History</CardTitle>
        <CardDescription>
          Permanent record of pupil and guardian corrections. Entries cannot be
          edited or deleted in the application.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {entries.length === 0 ? (
          <EmptyState
            title="No profile changes recorded"
            description="When staff correct pupil or guardian details, each field change appears here."
            icon={
              <History className="size-6 text-muted-foreground" aria-hidden />
            }
            size="sm"
          />
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="space-y-2 rounded-xl border p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">
                    {formatDateTime(entry.createdAt)}
                  </p>
                  <StatusBadge tone="neutral">
                    {entry.entityType === "student" ? "Pupil" : "Guardian"}
                  </StatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Changed by: {entry.changedByName}
                </p>
                <p className="font-medium">{entry.fieldLabel}</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                      Old
                    </dt>
                    <dd className="break-words">{entry.oldValue}</dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                      New
                    </dt>
                    <dd className="break-words">{entry.newValue}</dd>
                  </div>
                </dl>
                <p className="text-sm">
                  Reason: {entry.changeReasonLabel}
                  {entry.changeNote ? ` — ${entry.changeNote}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}

        {entries.length >= 50 ? (
          <p className="text-xs text-muted-foreground">
            Showing the 50 most recent changes.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
