import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("visibility migration", () => {
  it("persists verbosity and idempotent Telegram delivery cursors", async () => {
    const sql = await readFile(
      new URL("../../prisma/migrations/20260724220000_visibility/migration.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain('"verbose_level" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('CHECK ("verbose_level" BETWEEN 0 AND 2)');
    expect(sql).toContain('CREATE TABLE "telegram_task_deliveries"');
    expect(sql).toContain('"last_log_sequence" INTEGER NOT NULL DEFAULT -1');
    expect(sql).toContain('"last_log_offset" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"final_delivered_at" TIMESTAMP(3)');
  });
});
