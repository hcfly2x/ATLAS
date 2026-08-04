import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const stateMigrationUrl = new URL(
  "../../prisma/migrations/20260803180000_add_paused_task_state/migration.sql",
  import.meta.url,
);
const metadataMigrationUrl = new URL(
  "../../prisma/migrations/20260803180100_add_task_pause_metadata/migration.sql",
  import.meta.url,
);

describe("C2c additive schema migrations", () => {
  it("adds PAUSED in an isolated PostgreSQL enum migration", async () => {
    const sql = (await readFile(stateMigrationUrl, "utf8")).trim();

    expect(sql).toBe("ALTER TYPE \"TaskState\" ADD VALUE 'PAUSED';");
  });

  it("adds pause metadata, constrained priority and the scheduler index without backfill", async () => {
    const sql = await readFile(metadataMigrationUrl, "utf8");

    expect(sql).toContain("CREATE TYPE \"TaskPauseOrigin\" AS ENUM ('WAITING_APPROVAL', 'QUEUED')");
    expect(sql).toContain('ADD COLUMN "paused_from_state" "TaskPauseOrigin"');
    expect(sql).toContain('ADD COLUMN "priority" SMALLINT NOT NULL DEFAULT 0');
    expect(sql).toContain('CONSTRAINT "tasks_priority_allowed"');
    expect(sql).toContain('CHECK ("priority" IN (0, 10, 20))');
    expect(sql).toContain('CONSTRAINT "tasks_paused_origin_consistent"');
    expect(sql).toContain('"state" = \'PAUSED\' AND "paused_from_state" IS NOT NULL');
    expect(sql).toContain('"state" <> \'PAUSED\' AND "paused_from_state" IS NULL');
    expect(sql).toContain('CREATE INDEX "tasks_state_priority_created_at_id_idx"');
    expect(sql).toContain('("state", "priority" DESC, "created_at", "id")');
    expect(sql).not.toMatch(/\bUPDATE\b/u);
    expect(sql).not.toContain('ALTER TYPE "DashboardCommandType"');
  });
});
