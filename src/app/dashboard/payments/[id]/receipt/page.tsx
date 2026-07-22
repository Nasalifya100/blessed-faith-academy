import { notFound } from "next/navigation";

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

function moneyOrDash(value: number | null): string {
  return value == null ? "—" : formatKwacha(value);
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
  const schoolInitials = receipt.school.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

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
          <div className="mx-auto flex size-16 items-center justify-center overflow-hidden rounded-2xl border bg-muted/40 print:border-black">
            {receipt.school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={receipt.school.logoUrl}
                alt=""
                className="size-full object-contain p-1"
              />
            ) : (
              <span className="text-lg font-bold tracking-tight">
                {schoolInitials}
              </span>
            )}
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {receipt.school.name}
            </h1>
            {receipt.school.motto ? (
              <p className="text-sm italic text-muted-foreground print:text-neutral-600">
                {receipt.school.motto}
              </p>
            ) : null}
            {receipt.school.address ? (
              <p className="text-sm text-muted-foreground print:text-neutral-600">
                {receipt.school.address}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground print:text-neutral-600">
              {[
                receipt.school.phone ? `Tel: ${receipt.school.phone}` : null,
                receipt.school.email,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <p className="text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase print:text-neutral-700">
            Official payment receipt
          </p>
          {isVoided ? (
            <p className="text-base font-bold tracking-wide text-destructive uppercase print:text-black">
              Voided / reversed — not valid as payment
            </p>
          ) : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
            Receipt details
          </h2>
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
                Payment reference
              </dt>
              <dd>{receipt.referenceNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Method
              </dt>
              <dd>{methodLabel}</dd>
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
          </dl>
        </section>

        <section className="space-y-3 border-t pt-4 print:border-black">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
            Student details
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Student name
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
                Grade
              </dt>
              <dd>{receipt.student.gradeName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Class
              </dt>
              <dd>{receipt.student.className ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3 border-t pt-4 print:border-black">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
            Payer details
          </h2>
          {receipt.payer ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Payer name
                </dt>
                <dd className="font-medium">{receipt.payer.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Relationship
                </dt>
                <dd className="capitalize">
                  {receipt.payer.relationship ?? "Guardian"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Phone
                </dt>
                <dd>{receipt.payer.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground print:text-neutral-600">
                  Email
                </dt>
                <dd>{receipt.payer.email ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground print:text-neutral-600">
              No guardian on file for this student.
            </p>
          )}
        </section>

        <section className="space-y-3 border-t pt-4 print:border-black">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
            Payment summary
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-lg">
              <span className="font-medium">
                {isVoided ? "Original amount received" : "Amount received"}
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
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground print:text-neutral-600">
                Applied to charges
              </span>
              <span className="font-semibold tabular-nums">
                {formatKwacha(receipt.amountAllocated)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground print:text-neutral-600">
                Advance credit created
              </span>
              <span className="font-semibold tabular-nums">
                {formatKwacha(receipt.creditCreated)}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t pt-4 print:border-black">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
            Allocation breakdown
          </h2>
          {receipt.allocations.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {receipt.allocations.map((allocation) => (
                <li
                  key={allocation.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed pb-2 last:border-0 last:pb-0 print:border-neutral-300"
                >
                  <span>
                    {allocation.feeItemName}
                    {allocation.academicYearName
                      ? ` · ${allocation.academicYearName}`
                      : ""}
                    {allocation.termName ? ` · ${allocation.termName}` : ""}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatKwacha(allocation.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground print:text-neutral-600">
              No charge allocations for this payment
              {receipt.creditCreated > 0
                ? " — amount retained as available credit."
                : "."}
            </p>
          )}
        </section>

        <section className="space-y-3 border-t pt-4 print:border-black">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
            Account balances at payment time
          </h2>
          {!receipt.snapshot ? (
            <p className="text-sm text-muted-foreground print:text-neutral-600">
              Balance snapshot was not stored for this receipt (recorded before
              live balance snapshots). Historical figures are not recalculated.
            </p>
          ) : null}
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1">
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Balance before payment
              </dt>
              <dd className="font-semibold tabular-nums">
                {moneyOrDash(receipt.balanceBefore)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1">
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Balance after payment
              </dt>
              <dd className="font-semibold tabular-nums">
                {moneyOrDash(receipt.balanceAfter)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1">
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Available credit before
              </dt>
              <dd className="font-semibold tabular-nums">
                {moneyOrDash(receipt.availableCreditBefore)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1">
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Available credit after
              </dt>
              <dd className="font-semibold tabular-nums">
                {moneyOrDash(receipt.availableCreditAfter)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2 sm:block sm:space-y-1">
              <dt className="text-xs text-muted-foreground print:text-neutral-600">
                Outstanding after payment
              </dt>
              <dd className="font-semibold tabular-nums">
                {moneyOrDash(receipt.outstandingAfter)}
              </dd>
            </div>
          </dl>
        </section>

        {receipt.notes ? (
          <section className="space-y-1 border-t pt-4 print:border-black">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
              Notes
            </h2>
            <p className="text-sm">{receipt.notes}</p>
          </section>
        ) : null}

        {isVoided ? (
          <section className="space-y-3 border-t pt-4 print:border-black">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase print:text-neutral-700">
              Reversal details
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
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
            </dl>
          </section>
        ) : null}

        <footer className="space-y-2 border-t pt-6 text-center print:border-black">
          <p className="text-sm font-medium">
            {isVoided
              ? "This receipt has been reversed and does not count as payment."
              : "Thank you. Please keep this receipt for your records."}
          </p>
          <p className="text-xs text-muted-foreground print:text-neutral-600">
            Issued by {receipt.school.name}
            {receipt.recordedByName
              ? ` · Recorded by ${receipt.recordedByName}`
              : ""}
            {receipt.referenceNumber
              ? ` · Ref ${receipt.referenceNumber}`
              : ""}
          </p>
          <p className="text-[11px] text-muted-foreground print:text-neutral-500">
            This is an official school finance document. Balances shown are the
            immutable snapshot captured when the payment was recorded.
          </p>
        </footer>
      </article>
    </PageShell>
  );
}
