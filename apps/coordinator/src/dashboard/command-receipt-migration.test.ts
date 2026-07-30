import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260730010000_dashboard_command_receipts/migration.sql",
  import.meta.url,
);

describe("Dashboard command receipt migration", () => {
  it("is additive and stores only bounded command evidence", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "dashboard_command_receipts"');
    expect(sql).toContain('"request_hash" TEXT NOT NULL');
    expect(sql).toContain('"result_code" TEXT');
    expect(sql).toContain('"result_payload" JSONB');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/u);
    expect(sql).not.toContain("objective");
    expect(sql).not.toContain("reason");
    expect(sql).not.toContain("prompt");
  });
});
