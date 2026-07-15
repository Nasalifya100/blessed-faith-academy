import Link from "next/link";
import { notFound } from "next/navigation";

import { getPaymentReceipt } from "@/features/fees/queries";
import { PAYMENT_METHOD_LABELS } from "@/features/fees/schemas";
import { PrintReceiptButton } from "@/features/fees/components/print-receipt-button";
import { formatKwacha } from "@/lib/money";
import { buttonVariants } from "@/components/ui/button";

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
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Link
          href={`/dashboard/students/${receipt.student.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          &larr; Back to student
        </Link>
        <PrintReceiptButton />
      </div>

      <article className="space-y-6 rounded-lg border p-8 print:border-0 print:p-0">
        <header className="space-y-1 border-b pb-4 text-center">
          <h1 className="text-2xl font-bold">{receipt.school.name}</h1>
          {receipt.school.address ? (
            <p className="text-sm text-muted-foreground">
              {receipt.school.address}
            </p>
          ) : null}
          {receipt.school.phone ? (
            <p className="text-sm text-muted-foreground">
              Tel: {receipt.school.phone}
            </p>
          ) : null}
          <p className="pt-2 text-lg font-semibold tracking-wide uppercase">
            Payment receipt
          </p>
          {isVoided ? (
            <p className="pt-2 text-base font-bold tracking-wide text-destructive uppercase">
              Voided / reversed — not valid as payment
            </p>
          ) : null}
        </header>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Receipt number</dt>
            <dd className="font-mono font-medium">{receipt.receiptNumber}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Date paid</dt>
            <dd>{formatDate(receipt.paidOn)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Student</dt>
            <dd className="font-medium">{receipt.student.fullName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Admission number</dt>
            <dd className="font-mono text-sm">
              {receipt.student.admissionNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Payment method</dt>
            <dd>{methodLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd>{receipt.referenceNumber ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Recorded by</dt>
            <dd>{receipt.recordedByName ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="capitalize font-medium">
              {isVoided ? "Voided / reversed" : receipt.status}
            </dd>
          </div>
          {receipt.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd>{receipt.notes}</dd>
            </div>
          ) : null}
          {isVoided ? (
            <>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  Reversal reason
                </dt>
                <dd>{receipt.voidReason ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reversed by</dt>
                <dd>{receipt.voidedByName ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reversed at</dt>
                <dd>
                  {receipt.voidedAt ? formatDateTime(receipt.voidedAt) : "-"}
                </dd>
              </div>
            </>
          ) : null}
        </dl>

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between text-lg">
            <span className="font-medium">
              {isVoided ? "Original amount" : "Amount paid"}
            </span>
            <span
              className={`font-bold ${isVoided ? "line-through text-muted-foreground" : ""}`}
            >
              {formatKwacha(receipt.amount)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {isVoided
                ? "Current student balance"
                : "Remaining balance"}
            </span>
            <span className="font-semibold">
              {formatKwacha(receipt.balanceAfter)}
            </span>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {isVoided
            ? "This receipt has been reversed and does not count as payment."
            : "Thank you. Please keep this receipt for your records."}
        </p>
      </article>
    </div>
  );
}
