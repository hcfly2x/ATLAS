import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260805010000_dashboard_project_commands/migration.sql",
  import.meta.url,
);

describe("Dashboard project command migration", () => {
  it("adds only the four receipt command values in an isolated additive migration", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql.match(/ALTER TYPE "DashboardCommandType" ADD VALUE/g)).toHaveLength(4);
    for (const value of [
      "CREATE_PROJECT",
      "UPDATE_PROJECT_CONFIG",
      "ACTIVATE_PROJECT",
      "DEACTIVATE_PROJECT",
    ]) {
      expect(sql).toContain(`ADD VALUE '${value}'`);
    }
    expect(sql).not.toMatch(/\b(?:CREATE TABLE|ALTER TABLE|DROP|UPDATE|DELETE|TRUNCATE)\b/u);
  });
});
