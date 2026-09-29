import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { runStaticChecks, ONLINE_ONLY } = require("./finance-integrity-verify.cjs") as {
  runStaticChecks: () => {
    ok: boolean;
    checks: { id: string; name: string; ok: boolean; detail: string }[];
  };
  ONLINE_ONLY: string[];
};

const result = runStaticChecks();

describe("finance integrity verifier", () => {
  it("runs entirely offline and reports every invariant", () => {
    expect(result.checks.length).toBeGreaterThanOrEqual(20);
  });

  for (const entry of result.checks) {
    it(`${entry.id} — ${entry.name}`, () => {
      expect(entry.ok, entry.detail).toBe(true);
    });
  }

  it("covers FIN-01 through FIN-20", () => {
    const ids = new Set(result.checks.map((entry) => entry.id));
    for (let index = 1; index <= 20; index += 1) {
      const id = `FIN-${String(index).padStart(2, "0")}`;
      expect(ids.has(id), `${id} is not verified`).toBe(true);
    }
  });

  it("declares which invariants need live data instead of guessing", () => {
    expect(ONLINE_ONLY.length).toBeGreaterThan(0);
  });
});
