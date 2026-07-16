"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Shield,
  UserCheck,
  UserMinus,
  UserRound,
  Users,
} from "lucide-react";

import {
  updateStaffRoleAction,
  setStaffActiveAction,
} from "@/features/staff/actions";
import { STAFF_ROLES } from "@/features/staff/schemas";
import { ROLE_LABELS, type StaffRole } from "@/features/auth/types";
import type { StaffMember } from "@/features/staff/queries";
import {
  StaffRoleBadge,
  StaffStatusBadge,
  isOfficeRole,
  permissionsSummaryForRole,
} from "@/features/staff/components/staff-badges";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionHeading } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { stickyHeaderClass, filterPanelClassName } from "@/components/ui/admin-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
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
import { cn } from "@/lib/utils";

interface StaffTableProps {
  staff: StaffMember[];
  currentUserId: string;
}

export function StaffTable({ staff, currentUserId }: StaffTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<StaffRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    nextActive: boolean;
    name: string;
  } | null>(null);

  const totals = useMemo(() => {
    const active = staff.filter((m) => m.is_active).length;
    const inactive = staff.length - active;
    const teachers = staff.filter((m) => m.role === "teacher").length;
    const administrators = staff.filter(
      (m) => m.role === "administrator",
    ).length;
    const office = staff.filter((m) => isOfficeRole(m.role)).length;
    return {
      total: staff.length,
      active,
      inactive,
      teachers,
      office,
      administrators,
    };
  }, [staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((member) => {
      if (roleFilter !== "all" && member.role !== roleFilter) return false;
      if (statusFilter === "active" && !member.is_active) return false;
      if (statusFilter === "inactive" && member.is_active) return false;
      if (!q) return true;
      return (
        member.full_name.toLowerCase().includes(q) ||
        (member.email ?? "").toLowerCase().includes(q) ||
        (member.phone ?? "").toLowerCase().includes(q) ||
        ROLE_LABELS[member.role].toLowerCase().includes(q)
      );
    });
  }, [roleFilter, search, staff, statusFilter]);

  const selected =
    staff.find((member) => member.id === selectedId) ??
    filtered.find((member) => member.id === selectedId) ??
    null;

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

  function requestToggleActive(member: StaffMember) {
    setConfirm({
      id: member.id,
      nextActive: !member.is_active,
      name: member.full_name,
    });
  }

  function confirmToggleActive() {
    if (!confirm) return;
    const { id, nextActive } = confirm;
    setError(null);
    startTransition(async () => {
      const result = await setStaffActiveAction({ id, is_active: nextActive });
      setConfirm(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Total staff"
          value={String(totals.total)}
          hint="All accounts"
          icon={Users}
          tone="info"
        />
        <StatCard
          title="Active staff"
          value={String(totals.active)}
          hint="Can sign in"
          icon={UserCheck}
          tone="success"
        />
        <StatCard
          title="Inactive staff"
          value={String(totals.inactive)}
          hint="Access disabled"
          icon={UserMinus}
          tone={totals.inactive > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Teachers"
          value={String(totals.teachers)}
          hint="Teaching roles"
          icon={UserRound}
          tone="success"
        />
        <StatCard
          title="Office staff"
          value={String(totals.office)}
          hint="Headteacher, secretary, bursar"
          icon={Shield}
          tone="info"
        />
        <StatCard
          title="Administrators"
          value={String(totals.administrators)}
          hint="System admins"
          icon={Shield}
          tone="danger"
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Staff directory</CardTitle>
          <CardDescription>
            Search and filter accounts. Select a person to view their profile
            card and manage role or access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="search"
            aria-label="Staff filters"
            className={filterPanelClassName()}
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="staff-search">Search</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="staff-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, email, phone, or role…"
                  className="h-11 pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-filter">Role</Label>
              <SelectNative
                id="role-filter"
                value={roleFilter}
                onChange={(event) =>
                  setRoleFilter(event.target.value as StaffRole | "all")
                }
                className="h-11"
              >
                <option value="all">All roles</option>
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </SelectNative>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-filter">Status</Label>
              <SelectNative
                id="status-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as "all" | "active" | "inactive",
                  )
                }
                className="h-11"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectNative>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {staff.length === 0 ? (
            <EmptyState
              title="No staff"
              description="Create a staff account above to get started."
              size="sm"
              icon={
                <Users className="size-6 text-muted-foreground" aria-hidden />
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={
                statusFilter === "inactive"
                  ? "No inactive staff"
                  : "No search results"
              }
              description="Try clearing search or changing role and status filters."
              size="sm"
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Showing {filtered.length} of {staff.length}
              </p>

              <div className="hidden max-h-[min(70vh,40rem)] overflow-auto rounded-xl border shadow-sm md:block">
                <Table>
                  <TableHeader className={stickyHeaderClass}>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((member) => {
                      const isSelf = member.id === currentUserId;
                      return (
                        <TableRow
                          key={member.id}
                          className={cn(
                            "cursor-pointer",
                            selectedId === member.id && "bg-muted/50",
                          )}
                          onClick={() => setSelectedId(member.id)}
                        >
                          <TableCell className="font-medium">
                            {member.full_name}
                            {isSelf ? (
                              <span className="text-muted-foreground">
                                {" "}
                                (you)
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <StaffRoleBadge role={member.role} />
                          </TableCell>
                          <TableCell>
                            <StaffStatusBadge isActive={member.is_active} />
                          </TableCell>
                          <TableCell className="text-sm">
                            {member.email ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {member.phone ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div
                              className="flex flex-wrap justify-end gap-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="min-h-10"
                                onClick={() => setSelectedId(member.id)}
                              >
                                View
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-10"
                                disabled={isPending || isSelf}
                                onClick={() => requestToggleActive(member)}
                              >
                                {member.is_active ? "Deactivate" : "Activate"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <ul className="space-y-3 md:hidden">
                {filtered.map((member) => {
                  const isSelf = member.id === currentUserId;
                  return (
                    <li key={member.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(member.id)}
                        className={cn(
                          "w-full space-y-3 rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          selectedId === member.id &&
                            "border-ring bg-muted/30",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {member.full_name}
                              {isSelf ? " (you)" : ""}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {member.email ?? "No email"}
                            </p>
                          </div>
                          <StaffStatusBadge isActive={member.is_active} />
                        </div>
                        <StaffRoleBadge role={member.role} />
                        <p className="text-sm text-muted-foreground">
                          Phone: {member.phone ?? "—"}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <StaffProfilePanel
          member={selected}
          isSelf={selected.id === currentUserId}
          isPending={isPending}
          onClose={() => setSelectedId(null)}
          onRoleChange={handleRoleChange}
          onRequestToggle={() => requestToggleActive(selected)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.nextActive
            ? `Activate ${confirm?.name ?? "staff member"}?`
            : `Deactivate ${confirm?.name ?? "staff member"}?`
        }
        description={
          confirm?.nextActive
            ? "This staff member will be able to sign in again with their existing credentials."
            : "This staff member will no longer be able to access the system."
        }
        confirmLabel={confirm?.nextActive ? "Activate" : "Deactivate"}
        tone={confirm?.nextActive ? "default" : "danger"}
        pending={isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmToggleActive}
      />
    </div>
  );
}

function StaffProfilePanel({
  member,
  isSelf,
  isPending,
  onClose,
  onRoleChange,
  onRequestToggle,
}: {
  member: StaffMember;
  isSelf: boolean;
  isPending: boolean;
  onClose: () => void;
  onRoleChange: (id: string, role: StaffRole) => void;
  onRequestToggle: () => void;
}) {
  const permissions = permissionsSummaryForRole(member.role);

  return (
    <Card className="shadow-sm" id="staff-profile">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>{member.full_name}</CardTitle>
          <CardDescription>
            Staff profile
            {isSelf ? " · This is your account" : ""}
          </CardDescription>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border p-4">
            <SectionHeading title="Basic information" />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Full name</dt>
                <dd className="font-medium">{member.full_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Role</dt>
                <dd className="mt-1">
                  <StaffRoleBadge role={member.role} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="mt-1">
                  <StaffStatusBadge isActive={member.is_active} />
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 rounded-xl border p-4">
            <SectionHeading title="Contact information" />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{member.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{member.phone ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 rounded-xl border p-4">
            <SectionHeading
              title="Employment information"
              description="Role is the employment type stored on this account."
            />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Assigned role</dt>
                <dd>{ROLE_LABELS[member.role]}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Department</dt>
                <dd>—</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last login</dt>
                <dd>—</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 rounded-xl border p-4">
            <SectionHeading
              title="Permissions summary"
              description="Derived from the assigned role — not a live audit log."
            />
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {permissions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="space-y-3 rounded-xl border border-dashed p-4">
          <SectionHeading title="Manage access" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`role-${member.id}`}>Change role</Label>
              <SelectNative
                id={`role-${member.id}`}
                value={member.role}
                disabled={isPending || isSelf}
                onChange={(event) =>
                  onRoleChange(member.id, event.target.value as StaffRole)
                }
                className="h-11"
                aria-label={`Role for ${member.full_name}`}
              >
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </SelectNative>
              {isSelf ? (
                <p className="text-xs text-muted-foreground">
                  You cannot change your own role here.
                </p>
              ) : null}
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={isPending || isSelf}
                onClick={onRequestToggle}
              >
                {member.is_active ? "Deactivate account" : "Activate account"}
              </Button>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
