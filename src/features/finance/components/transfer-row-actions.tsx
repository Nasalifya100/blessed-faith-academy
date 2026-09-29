"use client";

import { reverseTransferAction } from "../actions";
import { ReverseTransactionButton } from "./reverse-transaction-button";

export function TransferRowActions({
  transferId,
  label,
}: {
  transferId: string;
  label: string;
}) {
  return (
    <ReverseTransactionButton
      id={transferId}
      label={label}
      description="Both sides of the transfer will be reversed together, and both records stay on file."
      onReverse={({ reason }) =>
        reverseTransferAction({ transferId, reason })
      }
    />
  );
}
