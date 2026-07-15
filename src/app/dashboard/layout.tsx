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

  const displayName = current.profile?.full_name ?? current.email;
  const roleLabel = current.profile
    ? ROLE_LABELS[current.profile.role]
    : "No role assigned";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <p className="font-semibold">Blessed Faith Academy</p>
          <p className="text-xs text-muted-foreground">
            {displayName} &middot; {roleLabel}
          </p>
        </div>
        <SignOutButton />
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
