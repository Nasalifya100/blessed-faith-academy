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
  canViewStudentProfile,
} from "@/features/auth/permissions";

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
  it("gates student directory vs profile", () => {
    expect(canManageStudents("teacher")).toBe(false);
    expect(canBrowseStudents("teacher")).toBe(false);
    expect(canBrowseStudents("bursar")).toBe(true);
    expect(canViewStudentProfile("teacher")).toBe(true);
    expect(canManageApplications("bursar")).toBe(false);
    expect(canManageApplications("secretary")).toBe(true);
  });
});
