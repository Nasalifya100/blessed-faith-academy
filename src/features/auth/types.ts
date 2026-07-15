export type StaffRole =
  | "administrator"
  | "headteacher"
  | "bursar"
  | "secretary"
  | "teacher";

export interface Profile {
  id: string;
  school_id: string | null;
  full_name: string;
  role: StaffRole;
  phone: string | null;
  is_active: boolean;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  administrator: "Administrator",
  headteacher: "Headteacher",
  bursar: "Accounts / Bursar",
  secretary: "Secretary / Reception",
  teacher: "Teacher",
};
