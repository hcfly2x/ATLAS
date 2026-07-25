import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260725030000_post_execution_qa/migration.sql",
  import.meta.url,
);

describe("Post-execution QA migration", () => {
  it("adds an execution-scoped, terminally immutable review record without changing task states", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "post_execution_reviews"');
    expect(sql).toContain('"execution_id"');
    expect(sql).toContain('ON "post_execution_reviews"("execution_id")');
    expect(sql).toContain("final post_execution_reviews are immutable");
    expect(sql).not.toContain('ALTER TYPE "TaskState"');
  });
});
