import { describe, expect, it } from "vitest";

import { canManageStudents } from "@/features/auth/permissions";
import {
  buildFieldDiffs,
  maskSensitiveValue,
  updateGuardianProfileSchema,
  updateStudentProfileSchema,
  PROFILE_CHANGE_REASON_LABELS,
} from "@/features/students/profile-change-schemas";

describe("profile change permissions", () => {
  it("allows student managers and rejects others", () => {
    expect(canManageStudents("administrator")).toBe(true);
    expect(canManageStudents("headteacher")).toBe(true);
    expect(canManageStudents("secretary")).toBe(true);
    expect(canManageStudents("bursar")).toBe(false);
    expect(canManageStudents("teacher")).toBe(false);
    expect(canManageStudents(null)).toBe(false);
  });
});

describe("updateStudentProfileSchema", () => {
  const base = {
    student_id: "550e8400-e29b-41d4-a716-446655440000",
    admission_number: "BFA-001",
    first_name: "Ada",
    middle_name: "",
    last_name: "Banda",
    date_of_birth: "2015-01-01",
    gender: "female" as const,
    enrollment_date: "2024-01-10",
    place_of_birth: "",
    religious_denomination: "",
    previous_school: "",
    proposed_admission_date: "",
    is_zambian_citizen: true,
    medical_notes: "",
    vaccinated_smallpox: null,
    vaccination_date: "",
    change_reason: "typing_error" as const,
    change_note: "",
  };

  it("requires a correction reason", () => {
    const parsed = updateStudentProfileSchema.safeParse({
      ...base,
      change_reason: undefined,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a note when reason is other", () => {
    const parsed = updateStudentProfileSchema.safeParse({
      ...base,
      change_reason: "other",
      change_note: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts other with a note", () => {
    const parsed = updateStudentProfileSchema.safeParse({
      ...base,
      change_reason: "other",
      change_note: "Spelling on birth certificate",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects future dates of birth", () => {
    const parsed = updateStudentProfileSchema.safeParse({
      ...base,
      date_of_birth: "2099-01-01",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("updateGuardianProfileSchema", () => {
  const base = {
    student_id: "550e8400-e29b-41d4-a716-446655440000",
    guardian_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    first_name: "Mary",
    last_name: "Banda",
    phone: "0977123456",
    alt_phone: "",
    whatsapp: "",
    email: "",
    national_id: "",
    occupation: "",
    address: "",
    postal_address: "",
    relationship: "mother" as const,
    is_primary_contact: true,
    is_emergency_contact: true,
    change_reason: "contact_information_update" as const,
    change_note: "",
  };

  it("requires note for other", () => {
    expect(
      updateGuardianProfileSchema.safeParse({
        ...base,
        change_reason: "other",
        change_note: "  ",
      }).success,
    ).toBe(false);
  });

  it("accepts Zambia-style phone numbers", () => {
    expect(updateGuardianProfileSchema.safeParse(base).success).toBe(true);
    expect(
      updateGuardianProfileSchema.safeParse({
        ...base,
        phone: "+260 977 123 456",
      }).success,
    ).toBe(true);
  });

  it("rejects too-short phone numbers", () => {
    expect(
      updateGuardianProfileSchema.safeParse({
        ...base,
        phone: "123",
      }).success,
    ).toBe(false);
  });
});

describe("buildFieldDiffs", () => {
  it("creates no diffs when nothing changed", () => {
    const before = { first_name: "Ada", phone: "0977123456" };
    const after = { first_name: "Ada", phone: "0977123456" };
    expect(buildFieldDiffs(before, after, ["first_name", "phone"])).toEqual([]);
  });

  it("creates one diff for one changed field", () => {
    const diffs = buildFieldDiffs(
      { first_name: "Ada", last_name: "Banda" },
      { first_name: "Ada", last_name: "Phiri" },
      ["first_name", "last_name"],
    );
    expect(diffs).toEqual([
      { field_name: "last_name", old_value: "Banda", new_value: "Phiri" },
    ]);
  });

  it("creates multiple diffs for multiple changes with correct old/new", () => {
    const diffs = buildFieldDiffs(
      { phone: "0977123456", email: "a@example.com" },
      { phone: "0966987654", email: "b@example.com" },
      ["phone", "email"],
    );
    expect(diffs).toHaveLength(2);
    expect(diffs[0]).toEqual({
      field_name: "phone",
      old_value: "0977123456",
      new_value: "0966987654",
    });
    expect(diffs[1]).toEqual({
      field_name: "email",
      old_value: "a@example.com",
      new_value: "b@example.com",
    });
  });

  it("treats blank and null as equivalent", () => {
    expect(
      buildFieldDiffs(
        { middle_name: null },
        { middle_name: "  " },
        ["middle_name"],
      ),
    ).toEqual([]);
  });
});

describe("sensitive value masking", () => {
  it("masks phones and medical values", () => {
    expect(maskSensitiveValue("0977123456", "phone")).toBe("******3456");
    expect(maskSensitiveValue("Allergy to nuts", "medical_notes")).toBe(
      "•••• (restricted)",
    );
  });
});

describe("reason labels", () => {
  it("exposes friendly labels for every allowed reason", () => {
    expect(PROFILE_CHANGE_REASON_LABELS.typing_error).toBe("Typing error");
    expect(PROFILE_CHANGE_REASON_LABELS.other).toBe("Other");
  });
});
