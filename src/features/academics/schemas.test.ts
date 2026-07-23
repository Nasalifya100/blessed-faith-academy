import { describe, expect, it } from "vitest";

import {
  bandsOverlap,
  gradingSchemeSchema,
  RECOMMENDED_GRADING_BANDS,
  subjectSchema,
  weightSchemeSchema,
  weightTotal,
} from "@/features/academics/schemas";
import {
  canOpenAcademicSetup,
  hasAcademicCapability,
} from "@/features/academics/permissions";

describe("subjectSchema", () => {
  it("requires a subject name", () => {
    const result = subjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("defaults category to CORE", () => {
    const result = subjectSchema.parse({ name: "Mathematics" });
    expect(result.subject_category).toBe("CORE");
  });
});

describe("grading bands", () => {
  it("accepts the recommended default bands", () => {
    expect(bandsOverlap([...RECOMMENDED_GRADING_BANDS])).toBe(false);
    const parsed = gradingSchemeSchema.safeParse({
      name: "School grading scale",
      bands: RECOMMENDED_GRADING_BANDS,
      confirm: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("detects overlapping bands", () => {
    expect(
      bandsOverlap([
        { minimum_score: 50, maximum_score: 70 },
        { minimum_score: 65, maximum_score: 80 },
      ]),
    ).toBe(true);
  });
});

describe("weight schemes", () => {
  it("requires totals of 100%", () => {
    const bad = weightSchemeSchema.safeParse({
      name: "Default",
      items: [
        {
          assessment_type_id: "11111111-1111-4111-8111-111111111111",
          weight_percentage: 40,
        },
        {
          assessment_type_id: "22222222-2222-4222-8222-222222222222",
          weight_percentage: 50,
        },
      ],
    });
    expect(bad.success).toBe(false);

    const good = weightSchemeSchema.safeParse({
      name: "Default",
      items: [
        {
          assessment_type_id: "11111111-1111-4111-8111-111111111111",
          weight_percentage: 10,
        },
        {
          assessment_type_id: "22222222-2222-4222-8222-222222222222",
          weight_percentage: 20,
        },
        {
          assessment_type_id: "33333333-3333-4333-8333-333333333333",
          weight_percentage: 30,
        },
        {
          assessment_type_id: "44444444-4444-4444-8444-444444444444",
          weight_percentage: 40,
        },
      ],
      make_default: true,
      confirm: false,
    });
    expect(good.success).toBe(true);
    expect(weightTotal(good.data!.items)).toBe(100);
  });
});

describe("academic capabilities", () => {
  it("allows administrators full academic setup", () => {
    expect(canOpenAcademicSetup("administrator")).toBe(true);
    expect(hasAcademicCapability("administrator", "SUBJECTS_MANAGE")).toBe(
      true,
    );
  });

  it("allows headteachers to manage academic configuration", () => {
    expect(hasAcademicCapability("headteacher", "GRADING_SCHEMES_MANAGE")).toBe(
      true,
    );
  });

  it("does not allow teachers to manage subjects", () => {
    expect(hasAcademicCapability("teacher", "SUBJECTS_MANAGE")).toBe(false);
    expect(hasAcademicCapability("teacher", "ACADEMIC_CONFIGURATION_VIEW")).toBe(
      true,
    );
  });
});
