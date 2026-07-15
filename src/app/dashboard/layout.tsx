import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { ROLE_LABELS } from "@/features/auth/types";
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

  // A deactivated staff member keeps a valid session but must not use the app.
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
  const canSeeFees = Boolean(
    current.profile?.role &&
      ["administrator", "bursar", "headteacher", "secretary"].includes(
        current.profile.role,
      ),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <p className="font-semibold">Blessed Faith Academy</p>
          <p className="text-xs text-muted-foreground">
            {displayName} &middot; {roleLabel}
          </p>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm hover:underline">
            Dashboard
          </Link>
          <Link href="/dashboard/students" className="text-sm hover:underline">
            Students
          </Link>
          <Link
            href="/dashboard/applications"
            className="text-sm hover:underline"
          >
            Applications
          </Link>
          {canSeeFees ? (
            <Link href="/dashboard/fees" className="text-sm hover:underline">
              Fees
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/dashboard/staff" className="text-sm hover:underline">
              Staff
            </Link>
          ) : null}
          <SignOutButton />
        </nav>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
