import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260725020000_project_runtime_manifest/migration.sql",
  import.meta.url,
);

describe("Project runtime migration", () => {
  it("adds the optional runtime manifest without changing the state model", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('ALTER TABLE "projects"');
    expect(sql).toContain('ADD COLUMN "runtime" JSONB');
    expect(sql).not.toContain("tasks");
  });
});
