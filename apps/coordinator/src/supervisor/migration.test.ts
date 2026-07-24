import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260724120000_supervisor_minimum/migration.sql",
  import.meta.url,
);

describe("Supervisor minimum migration", () => {
  it("adds autonomy, system/policy approvals and LLM usage accounting", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('ADD COLUMN "autonomy_level" INTEGER NOT NULL DEFAULT 2');
    expect(sql).toContain("CREATE TYPE \"ApprovalActor\" AS ENUM ('USER', 'SYSTEM')");
    expect(sql).toContain("CREATE TYPE \"ApprovalChannel\" AS ENUM ('TELEGRAM', 'POLICY')");
    expect(sql).toContain('CREATE TABLE "llm_calls"');
    expect(sql).toContain('"estimated_cost_usd" DECIMAL(12,8) NOT NULL');
    expect(sql).toContain('"latency_ms" INTEGER NOT NULL');
  });
});
