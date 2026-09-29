import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatKwacha } from "@/lib/money";

import { transactionStatusLabel } from "../presentation";
import type { LedgerEntry } from "../types";

function toneFor(entry: LedgerEntry): "default" | "secondary" | "destructive" {
  if (entry.isReversal || entry.reversedAt) return "destructive";
  if (entry.entryType === "income") return "default";
  return "secondary";
}

/**
 * Shared transaction list. Amounts are shown with an explicit in/out sign so a
 * reader never has to infer direction from the transaction type.
 */
export function TransactionTable({
  entries,
  showFund = true,
  showAccount = true,
  accountHeading = "Account",
  emptyMessage = "No transactions recorded yet.",
}: {
  entries: readonly LedgerEntry[];
  showFund?: boolean;
  showAccount?: boolean;
  accountHeading?: string;
  emptyMessage?: string;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Type</TableHead>
          {showFund ? <TableHead>Fund</TableHead> : null}
          {showAccount ? <TableHead>{accountHeading}</TableHead> : null}
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="tabular-nums">{entry.entryDate}</TableCell>
            <TableCell className="max-w-[24rem] whitespace-normal">
              <span className={entry.reversedAt ? "line-through" : undefined}>
                {entry.description}
              </span>
              {entry.payee ? (
                <span className="block text-xs text-muted-foreground">
                  {entry.payee}
                </span>
              ) : null}
              {entry.reversedAt ? (
                <span className="block text-xs text-muted-foreground">
                  Reversed{entry.reversalReason ? `: ${entry.reversalReason}` : ""}
                </span>
              ) : null}
            </TableCell>
            <TableCell>
              <Badge variant={toneFor(entry)}>
                {transactionStatusLabel(entry)}
              </Badge>
            </TableCell>
            {showFund ? (
              <TableCell>{entry.fundName ?? "—"}</TableCell>
            ) : null}
            {showAccount ? (
              <TableCell>{entry.accountName ?? "—"}</TableCell>
            ) : null}
            <TableCell
              className={
                entry.accountDelta >= 0
                  ? "text-right tabular-nums text-emerald-700 dark:text-emerald-300"
                  : "text-right tabular-nums text-red-700 dark:text-red-300"
              }
            >
              {entry.accountDelta >= 0 ? "+" : "−"}
              {formatKwacha(Math.abs(entry.accountDelta))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
