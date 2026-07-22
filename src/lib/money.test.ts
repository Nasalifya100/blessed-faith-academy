import { describe, expect, it } from "vitest";

import {
  addKwacha,
  fromNgwee,
  subKwacha,
  sumKwacha,
  toNgwee,
} from "@/lib/money";
import { schoolToday } from "@/lib/dates";
import { csvField, toCsv } from "@/features/reports/csv";
import {
  canBrowseStudents,
  canManageApplications,
  canManageStudents,
  canViewStudentMedical,
  canViewStudentProfile,
} from "@/features/auth/permissions";
import {
  createStudentSchema,
  archiveStudentSchema,
  transferStudentClassSchema,
} from "@/features/students/schemas";
import {
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/features/fees/schemas";
import {
  approveApplicationSchema,
  rejectApplicationSchema,
} from "@/features/applications/schemas";

describe("money (ngwee)", () => {
  it("converts to and from ngwee without float drift", () => {
    expect(toNgwee(0.1)).toBe(10);
    expect(toNgwee("12.34")).toBe(1234);
    expect(fromNgwee(1234)).toBe(12.34);
    expect(sumKwacha([0.1, 0.2])).toBe(0.3);
    expect(addKwacha(10.1, 0.2)).toBe(10.3);
    expect(subKwacha(10, 0.1)).toBe(9.9);
  });

  it("treats invalid amounts as zero", () => {
    expect(toNgwee(null)).toBe(0);
    expect(toNgwee("abc")).toBe(0);
  });
});

describe("csvField formula injection", () => {
  it("prefixes dangerous leading characters", () => {
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+cmd")).toBe("'+cmd");
    expect(csvField("-2")).toBe("'-2");
    expect(csvField("@SUM")).toBe("'@SUM");
    expect(csvField("\t=hijack")).toBe("'\t=hijack");
    // CR triggers CSV quoting after the formula prefix.
    expect(csvField("\r=hijack")).toBe("\"'\r=hijack\"");
    expect(csvField(" =1+1")).toBe("' =1+1");
  });

  it("quotes fields with commas", () => {
    expect(csvField("a,b")).toBe('"a,b"');
  });

  it("builds CSV rows", () => {
    expect(toCsv(["Name"], [["=hack"], ["ok"]])).toBe(
      "Name\r\n'=hack\r\nok",
    );
  });
});

describe("schoolToday", () => {
  it("returns YYYY-MM-DD", () => {
    expect(schoolToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("permissions", () => {
  it("gates student directory vs profile and medical", () => {
    expect(canManageStudents("teacher")).toBe(false);
    expect(canBrowseStudents("teacher")).toBe(false);
    expect(canBrowseStudents("bursar")).toBe(true);
    expect(canViewStudentProfile("teacher")).toBe(true);
    expect(canViewStudentMedical("bursar")).toBe(false);
    expect(canViewStudentMedical("secretary")).toBe(true);
    expect(canManageApplications("bursar")).toBe(false);
    expect(canManageApplications("secretary")).toBe(true);
  });
});

const UUID_A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const UUID_B = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const UUID_C = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

describe("admission number normalization", () => {
  it("uppercases admission numbers on parse", () => {
    const parsed = createStudentSchema.safeParse({
      admission_number: " bfa-12 ",
      first_name: "Ada",
      last_name: "Banda",
      date_of_birth: "2015-01-01",
      gender: "female",
      enrollment_date: "2026-01-15",
      class_id: UUID_A,
      guardians: [
        {
          first_name: "Mary",
          last_name: "Banda",
          relationship: "mother",
          is_primary_contact: true,
          is_emergency_contact: true,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.admission_number).toBe("BFA-12");
    }
  });
});

describe("payment schemas", () => {
  it("allows overpayment amounts (credit confirmation is handled in the action)", () => {
    const parsed = recordPaymentSchema.safeParse({
      studentId: UUID_A,
      amount: 50,
      method: "mobile_money",
      idempotencyKey: UUID_B,
      paid_on: "2026-07-15",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires void reason", () => {
    const parsed = voidPaymentSchema.safeParse({
      paymentId: UUID_A,
      studentId: UUID_B,
      reason: "ab",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("application review schemas", () => {
  it("requires reject notes", () => {
    const parsed = rejectApplicationSchema.safeParse({
      applicationId: UUID_A,
      notes: "no",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts approve payload", () => {
    const parsed = approveApplicationSchema.safeParse({
      applicationId: UUID_A,
      class_id: UUID_B,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("archive and transfer schemas", () => {
  it("accepts archive and transfer ids", () => {
    expect(
      archiveStudentSchema.safeParse({
        studentId: UUID_A,
        reason: "Left school",
      }).success,
    ).toBe(true);
    expect(
      transferStudentClassSchema.safeParse({
        studentId: UUID_A,
        newClassId: UUID_B,
      }).success,
    ).toBe(true);
  });
});
