import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../prisma/migrations/20260727190000_specification_delivery_mode/migration.sql",
  import.meta.url,
);

describe("Specification delivery mode migration", () => {
  it("adds a non-destructive repository_change default without changing task states", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TYPE "SpecificationDeliveryMode"');
    expect(sql).toContain('ALTER TABLE "specifications"');
    expect(sql).toContain(
      '"delivery_mode" "SpecificationDeliveryMode" NOT NULL DEFAULT \'REPOSITORY_CHANGE\'',
    );
    expect(sql).not.toContain('ALTER TYPE "TaskState"');
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bDELETE\b/);
  });
});
