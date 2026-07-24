import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260724022000_telegram_mvp/migration.sql",
  import.meta.url,
);

describe("Telegram MVP migration", () => {
  it("persists project selection and idempotent update/callback boundaries", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "telegram_sessions"');
    expect(sql).toContain('"selected_project_id" TEXT');
    expect(sql).toContain('CREATE TABLE "telegram_updates"');
    expect(sql).toContain('"update_id" BIGINT NOT NULL');
    expect(sql).toContain('"callback_id" TEXT');
    expect(sql).toContain('UNIQUE INDEX "telegram_updates_callback_id_key"');
  });
});
