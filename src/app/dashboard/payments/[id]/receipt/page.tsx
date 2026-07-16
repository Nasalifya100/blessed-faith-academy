import { notFound } from "next/navigation";
import { QrCode } from "lucide-react";

import { getPaymentReceipt } from "@/features/fees/queries";
import { PAYMENT_METHOD_LABELS } from "@/features/fees/schemas";
import {
  DownloadReceiptButton,
  PrintReceiptButton,
} from "@/features/fees/components/print-receipt-button";
import { formatKwacha } from "@/lib/money";
import { BackLink, PageShell } from "@/components/layout/page-shell";
import { cn } from "@/lib/utils";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZM", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-ZM", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PaymentReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receipt = await getPaymentReceipt(id);

  if (!receipt) {
    notFound();
  }

  const methodLabel =
    (PAYMENT_METHOD_LABELS as Record<string, string>)[receipt.method] ??
    receipt.method;
  const isVoided = receipt.status === "voided";

  return (
    <PageShell
      width="narrow"
      className="print:max-w-none print:space-y-0"
    >
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <BackLink href={`/dashboard/students/${receipt.student.id}`}>
          Back to student
        </BackLink>
        <PrintReceiptButton />
        <DownloadReceiptButton />
      </div>

      <article className="space-y-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8 print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none print:text-black">
        <header className="space-y-4 border-b pb-6 text-center print:border-black">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border bg-muted/40 print:border-black">
            <span className="text-lg font-bold tracking-tight">
              {receipt.school.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </span>
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {receipt.school.name}
            </h1>
            {receipt.school.address ? (
              <p className="text-sm text-muted-foreground print:text-neutral-600">
                {receipt.school.address}
              </p>
            ) : null}
            {receipt.school.phone ? (
              <p className="text-sm text-muted-foreground print:text-neutral-600">
                Tel: {receipt.school.phone}
              </p>
            ) : null}
          </div>
          <p className="text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase print:text-neutral-700">
            Payment receipt
          </p>
          {isVoided ? (
            <p className="text-base font-bold tracking-wide text-destructive uppercase print:text-black">
              Voided / reversed — not valid as payment
            </p>
          ) : null}
        </header>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Receipt number
            </dt>
            <dd className="font-mono text-sm font-medium">
              {receipt.receiptNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Payment date
            </dt>
            <dd>{formatDate(receipt.paidOn)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Student
            </dt>
            <dd className="font-medium">{receipt.student.fullName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Admission number
            </dt>
            <dd className="font-mono text-sm">
              {receipt.student.admissionNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Amount
            </dt>
            <dd
              className={cn(
                "text-xl font-semibold tabular-nums",
                isVoided && "text-muted-foreground line-through",
              )}
            >
              {formatKwacha(receipt.amount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Method
            </dt>
            <dd>{methodLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Reference
            </dt>
            <dd>{receipt.referenceNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Recorded by
            </dt>
            <dd>{receipt.recordedByName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground print:text-neutral-600">
              Status
            </dt>
            <dd className="font-medium capitalize">
              {isVoided ? "Voided / reversed" : receipt.status}
            </dd>
          </div>
          {receipt.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Notes
              </dt>
              <dd>{receipt.notes}</dd>
            </div>
          ) : null}
          {isVoided ? (
            <>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Reversal reason
                </dt>
                <dd>{receipt.voidReason ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Reversed by
                </dt>
                <dd>{receipt.voidedByName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Reversed at
                </dt>
                <dd>
                  {receipt.voidedAt ? formatDateTime(receipt.voidedAt) : "—"}
                </dd>
              </div>
            </>
          ) : null}
        </dl>

        <div className="space-y-3 border-t pt-4 print:border-black">
          <div className="flex items-center justify-between text-lg">
            <span className="font-medium">
              {isVoided ? "Original amount" : "Amount paid"}
            </span>
            <span
              className={cn(
                "font-bold tabular-nums",
                isVoided && "text-muted-foreground line-through",
              )}
            >
              {formatKwacha(receipt.amount)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground print:text-neutral-600">
              {isVoided ? "Current student balance" : "Remaining balance"}
            </span>
            <span className="font-semibold tabular-nums">
              {formatKwacha(receipt.balanceAfter)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 border-t pt-6 print:border-black">
          <div
            className="flex size-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground print:border-black print:text-neutral-500"
            aria-hidden
          >
            <QrCode className="size-10" />
            <span className="text-[10px] tracking-wide uppercase">
              QR placeholder
            </span>
          </div>
          <p className="text-center text-xs text-muted-foreground print:text-neutral-600">
            {isVoided
              ? "This receipt has been reversed and does not count as payment."
              : "Thank you. Please keep this receipt for your records."}
          </p>
        </div>
      </article>
    </PageShell>
  );
}
