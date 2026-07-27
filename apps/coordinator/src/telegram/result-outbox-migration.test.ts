import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260727230000_durable_result_delivery_outbox/migration.sql",
  import.meta.url,
);

describe("durable result delivery outbox migration", () => {
  it("adds an independent delivery status without changing the Task state machine", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain(
      "CREATE TYPE \"DeliveryOutboxStatus\" AS ENUM (\n  'PENDING',\n  'DELIVERED',\n  'DELIVERY_FAILED'",
    );
    expect(sql).toContain('CREATE TABLE "result_delivery_outbox"');
    expect(sql).toContain('"task_version" INTEGER NOT NULL');
    expect(sql).toContain('"destination_chat_id" BIGINT NOT NULL');
    expect(sql).toContain('"content_reference" TEXT NOT NULL');
    expect(sql).toContain('"attempts" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"next_attempt_at" TIMESTAMP(3) NOT NULL');
    expect(sql).toContain('"last_error" TEXT');
    expect(sql).toContain('CREATE UNIQUE INDEX "result_delivery_outbox_task_id_task_version_key"');
    expect(sql).not.toContain('ALTER TYPE "TaskState"');
    expect(sql).not.toContain('ALTER TABLE "tasks"');
  });
});
