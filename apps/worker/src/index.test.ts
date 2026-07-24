import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  CommandNotAllowedError,
  WorkerConcurrencyGate,
  findProtectedPathMatches,
  parseSpecificationCommand,
} from "./index.js";

describe("worker safety boundaries", () => {
  it("enforces the configured concurrency limit", async () => {
    const gate = new WorkerConcurrencyGate(1);
    let release: (() => void) | undefined;
    const first = gate.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(gate.run(() => Promise.resolve())).rejects.toThrow("WORKER_CONCURRENCY_LIMIT");
    release?.();
    await first;
  });

  it("rejects shell syntax instead of interpreting arbitrary strings", () => {
    expect(() => parseSpecificationCommand("pnpm test && rm -rf data")).toThrow(
      CommandNotAllowedError,
    );
    expect(parseSpecificationCommand("pnpm test")).toEqual({
      args: ["test"],
      executable: "pnpm",
    });
  });

  it("matches protected paths including dotfiles", () => {
    expect(
      findProtectedPathMatches(
        ["src/app.ts", ".env.local", "apps/worker/src/main.ts"],
        [".env*", "apps/worker/**"],
      ),
    ).toEqual([".env.local", "apps/worker/src/main.ts"]);
  });

  it("has no Docker, database or coordinator runtime dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});

    expect(dependencies).not.toContain("@prisma/client");
    expect(dependencies).not.toContain("pg");
    expect(dependencies).not.toContain("pg-boss");
    expect(dependencies.every((name) => !name.toLowerCase().includes("docker"))).toBe(true);
  });
});
