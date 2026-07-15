import { getCurrentUser } from "@/features/auth/queries/current-user";
import { ROLE_LABELS } from "@/features/auth/types";

export default async function DashboardPage() {
  const current = await getCurrentUser();
  const profile = current?.profile ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h1 className="text-2xl font-bold">
        Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
      </h1>
      <p className="text-muted-foreground">
        You are signed in as{" "}
        <span className="font-medium text-foreground">
          {profile ? ROLE_LABELS[profile.role] : "a user with no role assigned"}
        </span>
        .
      </p>
      <p className="text-sm text-muted-foreground">
        This is the secure dashboard. Features will appear here as we build them
        in the next phases.
      </p>
    </div>
  );
}
