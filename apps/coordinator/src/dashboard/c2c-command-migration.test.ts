import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260804210000_add_dashboard_task_command_types/migration.sql",
  import.meta.url,
);

describe("C2c dashboard command enum migration", () => {
  it("adds only the three command values in an isolated additive migration", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql.match(/ALTER TYPE "DashboardCommandType" ADD VALUE/g)).toHaveLength(3);
    expect(sql).toContain("ADD VALUE 'PAUSE_TASK'");
    expect(sql).toContain("ADD VALUE 'RESUME_TASK'");
    expect(sql).toContain("ADD VALUE 'SET_TASK_PRIORITY'");
    expect(sql).not.toMatch(/\b(?:CREATE TABLE|ALTER TABLE|DROP|UPDATE|DELETE|TRUNCATE)\b/u);
  });
});
