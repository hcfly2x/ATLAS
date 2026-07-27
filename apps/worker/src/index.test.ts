import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  CommandNotAllowedError,
  WorkerConcurrencyGate,
  authorizeRuntimeCommands,
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

  it("authorizes runtime bootstrap only when it is declared in the manifest", () => {
    const runtime = {
      allowed_commands: [
        { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
        { executable: "pnpm", args: ["validate"] },
      ],
      bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
      forbidden_commands: [],
      package_manager: "pnpm" as const,
      timeout_minutes: 10,
      validate: [{ executable: "pnpm", args: ["validate"] }],
    };
    expect(authorizeRuntimeCommands(runtime, "bootstrap", [])).toEqual([
      { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
    ]);
    expect(() =>
      authorizeRuntimeCommands(
        { ...runtime, bootstrap: [{ executable: "pnpm", args: ["test"] }] },
        "bootstrap",
        [],
      ),
    ).toThrow(CommandNotAllowedError);
  });

  it("denies a forbidden runtime command even when it is allowlisted", () => {
    expect(() =>
      authorizeRuntimeCommands(
        {
          allowed_commands: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
          bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
          forbidden_commands: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
          package_manager: "pnpm",
          timeout_minutes: 10,
          validate: [{ executable: "pnpm", args: ["validate"] }],
        },
        "bootstrap",
        [],
      ),
    ).toThrow(CommandNotAllowedError);
  });

  it("matches root and nested env paths without matching an unrelated path", () => {
    expect(
      findProtectedPathMatches(
        [
          ".env",
          ".env.local",
          "apps/coordinator/.env.local",
          "packages/example/.env.test",
          "apps/coordinator/src/main.ts",
        ],
        ["**/.env*"],
      ),
    ).toEqual([".env", ".env.local", "apps/coordinator/.env.local", "packages/example/.env.test"]);
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
