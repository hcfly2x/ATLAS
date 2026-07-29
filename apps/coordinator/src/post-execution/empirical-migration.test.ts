import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260728010000_empirical_review/migration.sql",
  import.meta.url,
);

describe("Empirical review migration", () => {
  it("adds an immutable execution-scoped advisory record without task states", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "empirical_reviews"');
    expect(sql).toContain("EmpiricalReviewVerdict");
    expect(sql).toContain("empirical_reviews are immutable");
    expect(sql).toContain('ON "empirical_reviews"("execution_id")');
    expect(sql).not.toContain('ALTER TYPE "TaskState"');
  });
});
