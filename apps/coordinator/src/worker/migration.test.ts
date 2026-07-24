import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260724150000_worker_codex_git/migration.sql",
  import.meta.url,
);

describe("Worker migration", () => {
  it("persists replay hashes, log chunks and Codex usage", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('ADD COLUMN "result_hash" TEXT');
    expect(sql).toContain('ADD COLUMN "finalization_idempotency_key" TEXT');
    expect(sql).toContain('CREATE TABLE "worker_log_chunks"');
    expect(sql).toContain('CREATE TABLE "codex_usages"');
    expect(sql).toContain('CREATE UNIQUE INDEX "worker_log_chunks_execution_id_sequence_key"');
  });
});
