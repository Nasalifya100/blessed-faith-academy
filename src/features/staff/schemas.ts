import { z } from "zod";

export const STAFF_ROLES = [
  "administrator",
  "headteacher",
  "bursar",
  "secretary",
  "teacher",
] as const;

export const createStaffSchema = z.object({
  full_name: z.string().min(2, "Full name is required"),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(STAFF_ROLES),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateRoleSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(STAFF_ROLES),
});

export const setActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
