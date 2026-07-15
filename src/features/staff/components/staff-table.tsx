"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  updateStaffRoleAction,
  setStaffActiveAction,
} from "@/features/staff/actions";
import { STAFF_ROLES } from "@/features/staff/schemas";
import { ROLE_LABELS, type StaffRole } from "@/features/auth/types";
import type { StaffMember } from "@/features/staff/queries";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";

interface StaffTableProps {
  staff: StaffMember[];
  currentUserId: string;
}

export function StaffTable({ staff, currentUserId }: StaffTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRoleChange(id: string, role: StaffRole) {
    setError(null);
    startTransition(async () => {
      const result = await updateStaffRoleAction({ id, role });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleToggleActive(id: string, nextActive: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setStaffActiveAction({ id, is_active: nextActive });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (staff.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No staff accounts yet. Add one above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((member) => {
              const isSelf = member.id === currentUserId;
              return (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.full_name}
                    {isSelf ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{member.email ?? "-"}</TableCell>
                  <TableCell>
                    <SelectNative
                      value={member.role}
                      disabled={isPending || isSelf}
                      onChange={(event) =>
                        handleRoleChange(
                          member.id,
                          event.target.value as StaffRole,
                        )
                      }
                      className="w-44"
                    >
                      {STAFF_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </SelectNative>
                  </TableCell>
                  <TableCell>
                    {member.is_active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending || isSelf}
                      onClick={() =>
                        handleToggleActive(member.id, !member.is_active)
                      }
                    >
                      {member.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
