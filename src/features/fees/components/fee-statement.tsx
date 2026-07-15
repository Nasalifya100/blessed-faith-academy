import type { StudentFeeStatement } from "@/features/fees/queries";
import { formatKwacha } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const METHOD_LABELS: Record<string, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
};

interface FeeStatementProps {
  statement: StudentFeeStatement;
}

export function FeeStatement({ statement }: FeeStatementProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total charged</p>
          <p className="text-lg font-semibold">
            {formatKwacha(statement.totalCharged)}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total paid</p>
          <p className="text-lg font-semibold">
            {formatKwacha(statement.totalPaid)}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p
            className={`text-lg font-semibold ${
              statement.balance > 0 ? "text-destructive" : "text-emerald-600"
            }`}
          >
            {formatKwacha(statement.balance)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Charges</h3>
        {statement.charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No charges yet for
            {statement.academicYearName
              ? ` ${statement.academicYearName}`
              : " this year"}
            .
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.charges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell>{charge.description}</TableCell>
                    <TableCell>{charge.termName ?? "Year"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {charge.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatKwacha(charge.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Payments</h3>
        {statement.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payments recorded yet. Recording payments comes in the next
            step.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono text-xs">
                      {payment.receiptNumber}
                    </TableCell>
                    <TableCell>
                      {METHOD_LABELS[payment.method] ?? payment.method}
                    </TableCell>
                    <TableCell>{payment.paidOn}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatKwacha(payment.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
