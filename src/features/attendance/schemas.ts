import { z } from "zod";

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "excused",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};

export const saveClassAttendanceSchema = z.object({
  classId: z.string().uuid(),
  attendanceDate: z
    .string()
    .min(1, "Date is required")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date"),
  marks: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        notes: z.string().optional().or(z.literal("")),
      }),
    )
    .min(1, "Mark at least one student"),
});

export type SaveClassAttendanceInput = z.infer<typeof saveClassAttendanceSchema>;

export const assignAttendanceCoverSchema = z.object({
  classId: z.string().uuid(),
  staffId: z.string().uuid(),
  validFrom: z
    .string()
    .min(1, "Start date is required")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date"),
  validUntil: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (value) => !value || !Number.isNaN(Date.parse(value)),
      "Enter a valid end date",
    ),
  reason: z.string().optional().or(z.literal("")),
});

export type AssignAttendanceCoverInput = z.infer<
  typeof assignAttendanceCoverSchema
>;

export const revokeAttendanceCoverSchema = z.object({
  coverId: z.string().uuid(),
});

export const setHomeroomTeacherSchema = z.object({
  classId: z.string().uuid(),
  staffId: z.string().uuid().nullable(),
});
