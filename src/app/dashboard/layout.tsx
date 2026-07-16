import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canBrowseStudents,
  canManageApplications,
} from "@/features/auth/permissions";
import { ROLE_LABELS } from "@/features/auth/types";
import {
  DashboardNav,
  type DashboardNavLink,
} from "@/features/dashboard/components/dashboard-nav";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const current = await getCurrentUser();
  if (!current) {
    redirect("/login");
  }

  if (!current.profileLoadFailed && !current.profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">No staff profile</h1>
          <p className="text-muted-foreground">
            Your login has no school role assigned. Please contact an
            administrator.
          </p>
        </div>
        <SignOutButton />
      </main>
    );
  }

  if (current.profile && !current.profile.is_active) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Account deactivated</h1>
          <p className="text-muted-foreground">
            Your account has been deactivated. Please contact an administrator.
          </p>
        </div>
        <SignOutButton />
      </main>
    );
  }

  const displayName = current.profile?.full_name ?? current.email;
  const roleLabel = current.profile
    ? ROLE_LABELS[current.profile.role]
    : "No role assigned";
  const isAdmin = current.profile?.role === "administrator";
  const canSeeStudents = canBrowseStudents(current.profile?.role);
  const canSeeApplications = canManageApplications(current.profile?.role);
  const canSeeFees = Boolean(
    current.profile?.role &&
      ["administrator", "bursar", "headteacher", "secretary"].includes(
        current.profile.role,
      ),
  );
  const canSeeAttendance = Boolean(
    current.profile?.role &&
      ["administrator", "headteacher", "secretary", "teacher"].includes(
        current.profile.role,
      ),
  );
  const canSeeRules = Boolean(
    current.profile?.role &&
      [
        "administrator",
        "headteacher",
        "secretary",
        "teacher",
        "bursar",
      ].includes(current.profile.role),
  );
  const canSeeDiscipline = Boolean(
    current.profile?.role &&
      ["administrator", "headteacher", "secretary", "teacher"].includes(
        current.profile.role,
      ),
  );
  const canSeeReports = Boolean(
    current.profile?.role &&
      [
        "administrator",
        "headteacher",
        "bursar",
        "secretary",
        "teacher",
      ].includes(current.profile.role),
  );

  const links: DashboardNavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    ...(canSeeStudents
      ? [{ href: "/dashboard/students", label: "Students" }]
      : []),
    ...(canSeeApplications
      ? [{ href: "/dashboard/applications", label: "Applications" }]
      : []),
    ...(canSeeAttendance
      ? [{ href: "/dashboard/attendance", label: "Attendance" }]
      : []),
    ...(canSeeFees ? [{ href: "/dashboard/fees", label: "Fees" }] : []),
    ...(canSeeRules ? [{ href: "/dashboard/rules", label: "Rules" }] : []),
    ...(canSeeDiscipline
      ? [{ href: "/dashboard/discipline", label: "Discipline" }]
      : []),
    ...(canSeeReports
      ? [{ href: "/dashboard/reports", label: "Reports" }]
      : []),
    ...(isAdmin ? [{ href: "/dashboard/staff", label: "Staff" }] : []),
    ...(isAdmin ? [{ href: "/dashboard/settings", label: "Settings" }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 print:hidden">
        <div className="min-w-0">
          <p className="font-semibold">Blessed Faith Academy</p>
          <p className="truncate text-xs text-muted-foreground">
            {displayName} &middot; {roleLabel}
          </p>
        </div>
        <DashboardNav links={links} />
      </header>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
