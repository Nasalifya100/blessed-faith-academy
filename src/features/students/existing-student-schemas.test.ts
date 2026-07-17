import { describe, expect, it } from "vitest";

import { canMigrateExistingStudents } from "@/features/auth/permissions";
import {
  createExistingStudentSchema,
  emptyOpeningChargeLine,
  isRecentAdmissionDate,
  openingOutstanding,
  sumOpeningOutstanding,
  toExistingStudentRpcPayload,
  type CreateExistingStudentInput,
} from "@/features/students/existing-student-schemas";
import { emptyGuardian } from "@/features/students/schemas";

function validBase(
  overrides: Partial<CreateExistingStudentInput> = {},
): CreateExistingStudentInput {
  const guardian = {
    ...emptyGuardian(true),
    first_name: "Grace",
    last_name: "Banda",
    phone: "0977123456",
  };
  return createExistingStudentSchema.parse({
    admission_number: "BFA-2022-0001",
    admission_date: "2022-01-14",
    legacy_reference: "paper register 2022",
    status: "enrolled",
    migration_notes: "Migrated at go-live",
    first_name: "Amina",
    middle_name: "",
    last_name: "Banda",
    date_of_birth: "2014-05-01",
    gender: "female",
    class_id: "11111111-1111-4111-8111-111111111111",
    placement_effective_date: "2022-01-14",
    place_of_birth: "",
    religious_denomination: "",
    previous_school: "",
    proposed_admission_date: "",
    vaccinated_smallpox: false,
    vaccination_date: "",
    medical_notes: "",
    is_zambian_citizen: true,
    guardians: [guardian],
    opening_charges: [],
    ...overrides,
  });
}

describe("openingOutstanding", () => {
  it("calculates outstanding as original minus previously paid", () => {
    expect(openingOutstanding(5000, 2000)).toBe(3000);
    expect(openingOutstanding(600, 0)).toBe(600);
  });

  it("uses ngwee-safe rounding", () => {
    expect(openingOutstanding(10.1, 0.2)).toBe(9.9);
  });
});

describe("sumOpeningOutstanding", () => {
  it("sums only positive outstanding lines", () => {
    const year = "22222222-2222-4222-8222-222222222222";
    const feeA = "33333333-3333-4333-8333-333333333333";
    const feeB = "44444444-4444-4444-8444-444444444444";
    expect(
      sumOpeningOutstanding([
        {
          ...emptyOpeningChargeLine(year, feeA),
          original_amount: 5000,
          previously_paid_amount: 2000,
        },
        {
          ...emptyOpeningChargeLine(year, feeB),
          original_amount: 600,
          previously_paid_amount: 600,
        },
      ]),
    ).toBe(3000);
  });
});

describe("createExistingStudentSchema", () => {
  it("accepts a historical admission date and enrolled status", () => {
    const parsed = validBase();
    expect(parsed.admission_date).toBe("2022-01-14");
    expect(parsed.status).toBe("enrolled");
    expect(parsed.admission_number).toBe("BFA-2022-0001");
  });

  it("rejects future admission dates", () => {
    const result = createExistingStudentSchema.safeParse({
      ...validBase(),
      admission_date: "2099-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects applicant status", () => {
    const result = createExistingStudentSchema.safeParse({
      ...validBase(),
      status: "applicant",
    });
    expect(result.success).toBe(false);
  });

  it("rejects previously paid greater than original", () => {
    const year = "22222222-2222-4222-8222-222222222222";
    const fee = "33333333-3333-4333-8333-333333333333";
    const result = createExistingStudentSchema.safeParse({
      ...validBase(),
      opening_charges: [
        {
          ...emptyOpeningChargeLine(year, fee),
          original_amount: 100,
          previously_paid_amount: 150,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amounts", () => {
    const year = "22222222-2222-4222-8222-222222222222";
    const fee = "33333333-3333-4333-8333-333333333333";
    const result = createExistingStudentSchema.safeParse({
      ...validBase(),
      opening_charges: [
        {
          ...emptyOpeningChargeLine(year, fee),
          original_amount: -10,
          previously_paid_amount: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate opening lines for same fee and period", () => {
    const year = "22222222-2222-4222-8222-222222222222";
    const fee = "33333333-3333-4333-8333-333333333333";
    const line = {
      ...emptyOpeningChargeLine(year, fee),
      original_amount: 100,
      previously_paid_amount: 0,
    };
    const result = createExistingStudentSchema.safeParse({
      ...validBase(),
      opening_charges: [line, { ...line }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts multiple opening charges for different fee items", () => {
    const year = "22222222-2222-4222-8222-222222222222";
    const parsed = validBase({
      opening_charges: [
        {
          ...emptyOpeningChargeLine(
            year,
            "33333333-3333-4333-8333-333333333333",
          ),
          original_amount: 5000,
          previously_paid_amount: 2000,
        },
        {
          ...emptyOpeningChargeLine(
            year,
            "44444444-4444-4444-8444-444444444444",
          ),
          original_amount: 600,
          previously_paid_amount: 0,
        },
      ],
    });
    expect(parsed.opening_charges).toHaveLength(2);
    expect(sumOpeningOutstanding(parsed.opening_charges)).toBe(3600);
  });
});

describe("toExistingStudentRpcPayload", () => {
  it("maps admission_date and never includes a payments array", () => {
    const payload = toExistingStudentRpcPayload(
      validBase({
        opening_charges: [
          {
            ...emptyOpeningChargeLine(
              "22222222-2222-4222-8222-222222222222",
              "33333333-3333-4333-8333-333333333333",
            ),
            original_amount: 900,
            previously_paid_amount: 0,
          },
        ],
      }),
    );
    expect(payload.admission_date).toBe("2022-01-14");
    expect(payload.status).toBe("enrolled");
    expect(payload).not.toHaveProperty("payments");
    expect(Array.isArray(payload.opening_charges)).toBe(true);
    expect(payload.opening_charges[0]).toMatchObject({
      original_amount: 900,
      previously_paid_amount: 0,
    });
  });
});

describe("isRecentAdmissionDate", () => {
  it("warns for dates within 60 days", () => {
    const today = new Date("2026-07-17T12:00:00Z");
    expect(isRecentAdmissionDate("2026-07-01", today)).toBe(true);
    expect(isRecentAdmissionDate("2022-01-14", today)).toBe(false);
  });
});

describe("canMigrateExistingStudents", () => {
  it("allows administrator and headteacher only among common roles", () => {
    expect(canMigrateExistingStudents("administrator")).toBe(true);
    expect(canMigrateExistingStudents("headteacher")).toBe(true);
    expect(canMigrateExistingStudents("secretary")).toBe(false);
    expect(canMigrateExistingStudents("bursar")).toBe(false);
    expect(canMigrateExistingStudents("teacher")).toBe(false);
    expect(canMigrateExistingStudents(null)).toBe(false);
  });

  it("still allows Administrator when role casing differs", () => {
    expect(canMigrateExistingStudents("Administrator" as never)).toBe(true);
    expect(canMigrateExistingStudents(" ADMINISTRATOR " as never)).toBe(true);
  });
});
