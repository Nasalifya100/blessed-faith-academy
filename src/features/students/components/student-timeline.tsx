"use client";

import Link from "next/link";
import {
  ArrowLeftRight,
  Banknote,
  ClipboardPenLine,
  GraduationCap,
  ShieldAlert,
} from "lucide-react";

import { formatKwacha } from "@/lib/money";
import type { StudentEnrolmentView } from "@/features/students/queries";
import type { StatementPayment } from "@/features/fees/queries";
import type { AttendanceCorrection } from "@/features/attendance/queries";
import type { DisciplineIncidentRow } from "@/features/discipline/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type TimelineItem = {
  id: string;
  date: string;
  title: string;
  detail: string;
  icon: typeof GraduationCap;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function StudentTimeline({
  enrollmentDate,
  enrolments,
  payments,
  corrections,
  incidents,
}: {
  enrollmentDate: string;
  enrolments: StudentEnrolmentView[];
  payments: StatementPayment[];
  corrections: AttendanceCorrection[];
  incidents: DisciplineIncidentRow[];
}) {
  const items: TimelineItem[] = [];

  if (enrollmentDate) {
    items.push({
      id: `enroll-${enrollmentDate}`,
      date: enrollmentDate,
      title: "Student enrolled",
      detail: "Recorded on the school register",
      icon: GraduationCap,
    });
  }

  for (const enrolment of enrolments) {
    items.push({
      id: `class-${enrolment.id}`,
      date: enrolment.enrolledOn,
      title: enrolment.isCurrent ? "Current class placement" : "Class transfer / placement",
      detail: `${enrolment.className} · ${enrolment.academicYearName} (${enrolment.status})`,
      icon: ArrowLeftRight,
    });
  }

  for (const payment of payments) {
    items.push({
      id: `pay-${payment.id}`,
      date: payment.paidOn,
      title:
        payment.status === "voided" ? "Payment reversed" : "Fee payment recorded",
      detail: `${formatKwacha(payment.amount)} · receipt ${payment.receiptNumber}`,
      icon: Banknote,
    });
  }

  for (const correction of corrections) {
    items.push({
      id: `att-${correction.id}`,
      date: correction.changedAt,
      title: "Attendance correction",
      detail: `${formatDate(correction.date)}: ${correction.oldStatus} → ${correction.newStatus}${
        correction.changedByName ? ` · ${correction.changedByName}` : ""
      }`,
      icon: ClipboardPenLine,
    });
  }

  for (const incident of incidents) {
    items.push({
      id: `disc-${incident.id}`,
      date: incident.incidentDate,
      title: "Discipline incident",
      detail: `${incident.title} · ${incident.severity} · ${incident.status}`,
      icon: ShieldAlert,
    });
  }

  items.sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>
          Key events built from enrolment, fees, attendance corrections, and
          discipline already on this profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            title="No history yet"
            description="Enrolment, payments, attendance corrections, and discipline events will appear here as they are recorded."
            size="sm"
          />
        ) : (
          <ol className="relative space-y-0 border-l border-border ml-3">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id} className="relative pb-8 pl-8 last:pb-0">
                  <span className="absolute top-0 -left-3.5 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm">
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <p className="text-xs font-medium text-muted-foreground">
                    {formatDate(item.date)}
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Looking for school-wide reports?{" "}
          <Link href="/dashboard/reports" className="underline underline-offset-2">
            Open reports
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
