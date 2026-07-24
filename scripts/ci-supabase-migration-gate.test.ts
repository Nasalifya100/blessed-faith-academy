import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const gate = require("./ci-supabase-migration-gate.cjs") as {
  parseMigrationList: (output: string) => {
    rows: Array<{ local: string; remote: string; kind: string }>;
    parsedRows: number;
    source: string;
  };
  evaluateMigrationGate: (args: {
    rows: Array<{ local: string; remote: string; kind: string }>;
    parsedRows: number;
    localFileCount: number;
  }) => {
    code: number;
    status: string;
    counts: Record<string, number>;
    details: { localOnly: string[]; remoteOnly: string[]; mismatches: unknown[] };
  };
};

const fixturesDir = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
);

function ansi(text: string): string {
  return `\u001b[32m${text}\u001b[0m`;
}

describe("ci-supabase-migration-gate parser", () => {
  it("A. parses backtick-formatted matching rows", () => {
    const output = [
      "   Local            | Remote           | Time (UTC)",
      "  ------------------|------------------|-----------------------",
      "   `20260715120000` | `20260715120000` | `2026-07-15 12:00:00`",
    ].join("\n");

    const { rows, parsedRows } = gate.parseMigrationList(output);
    expect(parsedRows).toBe(1);
    expect(rows[0]).toEqual({
      local: "20260715120000",
      remote: "20260715120000",
      kind: "matched",
    });
  });

  it("B. parses plain matching rows", () => {
    const output = [
      "Local | Remote | Time (UTC)",
      "------|--------|-----------",
      "20260715120000 | 20260715120000 | 2026-07-15 12:00:00",
    ].join("\n");

    const { rows, parsedRows } = gate.parseMigrationList(output);
    expect(parsedRows).toBe(1);
    expect(rows[0].kind).toBe("matched");
    expect(rows[0].local).toBe("20260715120000");
  });

  it("C. strips ANSI colour sequences", () => {
    const output = [
      `${ansi("Local")} | ${ansi("Remote")} | Time (UTC)`,
      `------------------|------------------|-----------------------`,
      `   ${ansi("`20260715120000`")} | ${ansi("`20260715120000`")} | ${ansi("`2026-07-15 12:00:00`")}`,
    ].join("\n");

    const { rows, parsedRows } = gate.parseMigrationList(output);
    expect(parsedRows).toBe(1);
    expect(rows[0].kind).toBe("matched");
  });

  it("D. parses CRLF output", () => {
    const output = [
      "Local | Remote | Time (UTC)",
      "------|--------|-----------",
      "`20260715120000` | `20260715120000` | `2026-07-15 12:00:00`",
      "",
    ].join("\r\n");

    const { rows, parsedRows } = gate.parseMigrationList(output);
    expect(parsedRows).toBe(1);
    expect(rows[0].kind).toBe("matched");
  });

  it("E. classifies one Local-only pending migration as pending_safe", () => {
    const output = [
      "Local | Remote | Time (UTC)",
      "20260715120000 | 20260715120000 | 2026-07-15 12:00:00",
      "20260723130400 |                  |",
    ].join("\n");

    const parsed = gate.parseMigrationList(output);
    expect(parsed.rows.map((r) => r.kind)).toEqual(["matched", "local-only"]);

    const result = gate.evaluateMigrationGate({
      rows: parsed.rows,
      parsedRows: parsed.parsedRows,
      localFileCount: 59,
    });
    expect(result.code).toBe(0);
    expect(result.status).toBe("pending_safe");
    expect(result.details.localOnly).toEqual(["20260723130400"]);
  });

  it("F. fails safely on one Remote-only migration", () => {
    const output = [
      "Local | Remote | Time (UTC)",
      "20260715120000 | 20260715120000 | 2026-07-15 12:00:00",
      "               | 20260799999999 | 2026-07-99 00:00:00",
    ].join("\n");

    const parsed = gate.parseMigrationList(output);
    const result = gate.evaluateMigrationGate({
      rows: parsed.rows,
      parsedRows: parsed.parsedRows,
      localFileCount: 58,
    });
    expect(result.code).toBe(1);
    expect(result.status).toBe("UNSAFE_REMOTE_ONLY");
  });

  it("G. ignores both-empty / unrelated pipe output", () => {
    const output = [
      "note | info | extra",
      "foo | bar | baz",
      " |  | ",
    ].join("\n");

    const { rows, parsedRows } = gate.parseMigrationList(output);
    expect(parsedRows).toBe(0);
    expect(rows).toEqual([]);
  });

  it("H. reports parse error for completely unparseable output", () => {
    const output = "not a migration table at all\njust noise\n";
    const parsed = gate.parseMigrationList(output);
    expect(parsed.parsedRows).toBe(0);

    const result = gate.evaluateMigrationGate({
      rows: parsed.rows,
      parsedRows: parsed.parsedRows,
      localFileCount: 58,
    });
    expect(result.code).toBe(3);
    expect(result.status).toBe("MIGRATION_LIST_PARSE_ERROR");
  });

  it("I. ignores .gitkeep skip messages", () => {
    const output = [
      'Skipping migration .gitkeep... (file name must match pattern "<timestamp>_name.sql")',
      "Local | Remote | Time (UTC)",
      "`20260715120000` | `20260715120000` | `2026-07-15 12:00:00`",
    ].join("\n");

    const { rows, parsedRows } = gate.parseMigrationList(output);
    expect(parsedRows).toBe(1);
    expect(rows[0].kind).toBe("matched");
  });

  it("J. parses all 58 current migrations matched (failed Action fixture)", () => {
    const fixture = fs.readFileSync(
      path.join(fixturesDir, "migration-list-action-backticks-58.txt"),
      "utf8",
    );
    const parsed = gate.parseMigrationList(fixture);
    expect(parsed.parsedRows).toBe(58);
    expect(parsed.rows.every((r) => r.kind === "matched")).toBe(true);

    const result = gate.evaluateMigrationGate({
      rows: parsed.rows,
      parsedRows: parsed.parsedRows,
      localFileCount: 58,
    });
    expect(result.code).toBe(0);
    expect(result.status).toBe("synced");
    expect(result.counts.remote_applied).toBe(58);
  });

  it("does not recommend reconciliation when parsed_rows=0 with local files", () => {
    const result = gate.evaluateMigrationGate({
      rows: [],
      parsedRows: 0,
      localFileCount: 58,
    });
    expect(result.code).toBe(3);
    expect(result.status).toBe("MIGRATION_LIST_PARSE_ERROR");
    expect(result.status).not.toBe("MIGRATION_RECONCILIATION_REQUIRED");
  });

  it("reports reconciliation only when every parsed row has empty Remote", () => {
    const output = [
      "Local | Remote | Time (UTC)",
      "20260715120000 |  |",
      "20260715130000 |  |",
    ].join("\n");
    const parsed = gate.parseMigrationList(output);
    const result = gate.evaluateMigrationGate({
      rows: parsed.rows,
      parsedRows: parsed.parsedRows,
      localFileCount: 2,
    });
    expect(result.code).toBe(2);
    expect(result.status).toBe("MIGRATION_RECONCILIATION_REQUIRED");
  });

  it("parses official JSON migration list output", () => {
    const output = JSON.stringify({
      migrations: [
        { local: "20260715120000", remote: "20260715120000", time: "2026-07-15 12:00:00" },
        { local: "20260723130400", remote: "", time: "" },
      ],
      message: "Migrations listed",
    });
    const parsed = gate.parseMigrationList(output);
    expect(parsed.source).toBe("json");
    expect(parsed.parsedRows).toBe(2);
    expect(parsed.rows.map((r) => r.kind)).toEqual(["matched", "local-only"]);
  });
});
