import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import { canManageExamSetup } from "@/features/examinations/permissions";
import { listExamRooms } from "@/features/examinations/queries";
import { ExamRoomForm } from "@/features/examinations/components/exam-setup-forms";
import {
  BackLink,
  PageHeader,
  PageShell,
} from "@/components/layout/page-shell";

export default async function ExamRoomsPage() {
  const current = await getCurrentUser();
  if (!current?.profile || !canManageExamSetup(current.profile.role)) {
    redirect("/dashboard/examinations");
  }

  const rooms = await listExamRooms(false);

  return (
    <PageShell>
      <BackLink href="/dashboard/examinations">Examinations</BackLink>
      <PageHeader
        title="Rooms"
        description="Simple room catalogue for exam seating."
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Add room</h2>
        <ExamRoomForm />
      </section>

      <section className="space-y-3 border-t pt-6">
        <h2 className="text-base font-semibold">Room list</h2>
        {rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rooms yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rooms.map((room) => (
              <li key={room.id} className="p-4">
                <p className="font-medium">
                  {room.name}
                  {!room.is_active ? " (inactive)" : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {room.capacity ? `Capacity ${room.capacity}` : "No capacity set"}
                  {room.notes ? ` · ${room.notes}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
