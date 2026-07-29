import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../prisma/migrations/20260728030000_independent_qa_reconciliation/migration.sql",
    import.meta.url,
  ),
);

describe("independent QA reconciliation migration", () => {
  it("adds nullable signals and a bounded reason without changing Task state", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('ADD COLUMN "empirical_verdict" "EmpiricalReviewVerdict"');
    expect(sql).toContain('ADD COLUMN "reviewer_decision" "PostExecutionReviewerDecision"');
    expect(sql).toContain('ADD COLUMN "reconciliation_reason" TEXT');
    expect(sql).toContain("post_execution_reviews_reconciliation_reason_check");
    expect(sql).not.toContain('ALTER TABLE "tasks"');
    expect(sql).not.toContain('ALTER TYPE "TaskState"');
    expect(sql).not.toMatch(/\bDROP\b/);
  });
});
