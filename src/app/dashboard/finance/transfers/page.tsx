import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { hasFinanceCapability } from "@/features/finance/capabilities";
import { FinanceNav } from "@/features/finance/components/finance-nav";
import { RecordTransferForm } from "@/features/finance/components/record-transfer-form";
import { TransferRowActions } from "@/features/finance/components/transfer-row-actions";
import { getFinancialAccounts, getTransfers } from "@/features/finance/queries";
import { formatKwacha } from "@/lib/money";
import { BackLink, PageHeader, PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function FinanceTransfersPage() {
  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!hasFinanceCapability(role, "FINANCE_ACCOUNTS_VIEW")) {
    redirect("/dashboard");
  }

  const [transfers, accounts] = await Promise.all([
    getTransfers(200),
    getFinancialAccounts(),
  ]);

  const canTransfer = hasFinanceCapability(role, "FINANCE_TRANSFER_RECORD");
  const canReverse = hasFinanceCapability(role, "FINANCE_REVERSE");

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Finance"
        title="Transfers"
        description="Money moved between the school's own accounts — for example a bank withdrawal to top up petty cash. Transfers are neither income nor expenditure."
        breadcrumb={<BackLink href="/dashboard/finance">Back to finance</BackLink>}
        actions={canTransfer ? <RecordTransferForm accounts={accounts} /> : null}
      />

      <FinanceNav role={role} current="/dashboard/finance/transfers" />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Transfer history</CardTitle>
          <CardDescription>
            Both sides of a transfer are recorded together. Reversing one
            reverses both.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transfers recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {canReverse ? <TableHead>Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell className="tabular-nums">
                      {transfer.transferDate}
                    </TableCell>
                    <TableCell>{transfer.fromAccountName ?? "—"}</TableCell>
                    <TableCell>{transfer.toAccountName ?? "—"}</TableCell>
                    <TableCell className="max-w-[18rem] whitespace-normal">
                      <span
                        className={
                          transfer.reversedAt ? "line-through" : undefined
                        }
                      >
                        {transfer.description}
                      </span>
                      {transfer.reversalReason ? (
                        <span className="block text-xs text-muted-foreground">
                          Reversed: {transfer.reversalReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwacha(transfer.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={transfer.reversedAt ? "destructive" : "success"}
                      >
                        {transfer.reversedAt ? "Reversed" : "Completed"}
                      </Badge>
                    </TableCell>
                    {canReverse ? (
                      <TableCell className="whitespace-normal">
                        {transfer.reversedAt ? null : (
                          <TransferRowActions
                            transferId={transfer.id}
                            label={`transfer of ${formatKwacha(transfer.amount)}`}
                          />
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
