import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260723220000_core_initial/migration.sql",
  import.meta.url,
);

describe("initial core migration", () => {
  it("contains ADR-012 idempotency, renewable lease and fencing columns", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('"idempotency_key" TEXT NOT NULL');
    expect(sql).toContain('"claim_idempotency_key" TEXT');
    expect(sql).toContain('"result_idempotency_key" TEXT');
    expect(sql).toContain('"lease_id" TEXT');
    expect(sql).toContain('"lease_expires_at" TIMESTAMP(3)');
    expect(sql).toContain('"fencing_token" BIGINT NOT NULL DEFAULT 0');
  });

  it("enforces immutable specifications and append-only audit events", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("CREATE TRIGGER audit_events_reject_update");
    expect(sql).toContain("CREATE TRIGGER audit_events_reject_delete");
    expect(sql).toContain("CREATE TRIGGER specifications_reject_update");
    expect(sql).toContain("CREATE TRIGGER specifications_reject_delete");
  });

  it("links executions to specifications and approvals to versioned targets", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('"specification_id" TEXT NOT NULL');
    expect(sql).toContain('"target_version" INTEGER');
    expect(sql).toContain('"target_hash" TEXT NOT NULL');
    expect(sql).toContain("executions_specification_id_fkey");
  });
});
