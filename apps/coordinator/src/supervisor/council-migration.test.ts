import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260724233000_multi_agent_council/migration.sql",
  import.meta.url,
);

describe("multi-agent council migration", () => {
  it("persists two bounded rounds and append-only specialist opinions", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "deliberations"');
    expect(sql).toContain('CONSTRAINT "deliberations_round_check" CHECK ("round" IN (1, 2))');
    expect(sql).toContain('CREATE TABLE "agent_opinions"');
    expect(sql).toContain('CREATE UNIQUE INDEX "agent_opinions_deliberation_id_agent_id_key"');
    expect(sql).toContain("agent_opinions is append-only");
    expect(sql).toContain('"input_tokens" >= 0');
  });
});
