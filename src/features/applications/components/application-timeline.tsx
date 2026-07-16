import { CheckCircle2, Circle, FileText, XCircle } from "lucide-react";

import type { ApplicationDetail } from "@/features/applications/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Step = {
  id: string;
  title: string;
  detail: string;
  state: "done" | "current" | "upcoming" | "rejected";
};

export function ApplicationTimeline({
  application,
}: {
  application: ApplicationDetail;
}) {
  const steps: Step[] = [
    {
      id: "created",
      title: "Application created",
      detail: "Applicant record opened in admissions",
      state: "done",
    },
    {
      id: "submitted",
      title: "Submitted",
      detail: application.submittedAt
        ? `${formatDate(application.submittedAt)}${
            application.submittedByName
              ? ` · ${application.submittedByName}`
              : ""
          }`
        : "Awaiting submission",
      state: application.submittedAt
        ? "done"
        : application.status === "draft"
          ? "current"
          : "upcoming",
    },
    {
      id: "reviewed",
      title: "Reviewed",
      detail: application.reviewedAt
        ? `${formatDate(application.reviewedAt)}${
            application.reviewedByName
              ? ` · ${application.reviewedByName}`
              : ""
          }`
        : "Awaiting review decision",
      state: application.reviewedAt
        ? "done"
        : application.status === "submitted"
          ? "current"
          : application.status === "draft"
            ? "upcoming"
            : "done",
    },
  ];

  if (application.status === "approved") {
    steps.push({
      id: "approved",
      title: "Approved",
      detail: application.decisionNotes
        ? application.decisionNotes
        : "Applicant enrolled into the chosen class",
      state: "done",
    });
  } else if (application.status === "rejected") {
    steps.push({
      id: "rejected",
      title: "Rejected",
      detail: application.decisionNotes ?? "Application declined",
      state: "rejected",
    });
  } else {
    steps.push({
      id: "decision",
      title: "Decision",
      detail: "Approve or reject when review is complete",
      state: "upcoming",
    });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>
          Admissions milestones from this application record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative ml-3 space-y-0 border-l">
          {steps.map((step) => {
            const Icon =
              step.state === "rejected"
                ? XCircle
                : step.state === "done"
                  ? CheckCircle2
                  : step.state === "current"
                    ? FileText
                    : Circle;
            return (
              <li key={step.id} className="relative pb-8 pl-8 last:pb-0">
                <span className="absolute top-0 -left-3.5 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm">
                  <Icon
                    className={
                      step.state === "rejected"
                        ? "size-3.5 text-destructive"
                        : step.state === "done"
                          ? "size-3.5 text-emerald-600"
                          : "size-3.5 text-muted-foreground"
                    }
                    aria-hidden
                  />
                </span>
                <p className="text-sm font-medium text-foreground">
                  {step.title}
                </p>
                <p className="text-sm text-muted-foreground">{step.detail}</p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
