import { describe, expect, it } from "vitest";

import type { WorkerRuntime } from "@atlas/shared";

import {
  CommandNotAllowedError,
  authorizeRuntimeCommands,
  findProtectedPathMatches,
} from "./index.js";

const runtime: WorkerRuntime = {
  allowed_commands: [
    { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
    { executable: "pnpm", args: ["validate"] },
  ],
  bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
  forbidden_commands: [],
  package_manager: "pnpm",
  timeout_minutes: 10,
  validate: [{ executable: "pnpm", args: ["validate"] }],
};

describe("current deterministic enforcement boundaries", () => {
  it("returns the same authorized command value without mutating configuration", () => {
    const before = structuredClone(runtime);

    const first = authorizeRuntimeCommands(runtime, "bootstrap", []);
    const second = authorizeRuntimeCommands(runtime, "bootstrap", []);

    expect(first).toEqual(second);
    expect(runtime).toEqual(before);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(runtime.bootstrap[0]);
  });

  it("applies a matching forbidden command before an identical allowlist entry", () => {
    const configured = {
      ...runtime,
      forbidden_commands: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
    };

    expect(() => authorizeRuntimeCommands(configured, "bootstrap", [])).toThrowError(
      new CommandNotAllowedError("Runtime bootstrap command is forbidden by the project manifest"),
    );
  });

  it("treats an empty forbidden args list as an executable-wide denial", () => {
    const configured = {
      ...runtime,
      forbidden_commands: [{ executable: "pnpm", args: [] }],
    };

    expect(() => authorizeRuntimeCommands(configured, "validate", [])).toThrow(
      "forbidden by the project manifest",
    );
  });

  it("denies a safe command whose arguments differ from the exact allowlist", () => {
    const configured = {
      ...runtime,
      validate: [{ executable: "pnpm", args: ["validate", "--fix"] }],
    };

    expect(() => authorizeRuntimeCommands(configured, "validate", [])).toThrow(
      "outside the project allowlist",
    );
  });

  it("preserves changed-path order and duplicate protected matches", () => {
    const changedPaths = ["src/app.ts", ".env.local", "apps/worker/src/main.ts", ".env.local"];

    expect(findProtectedPathMatches(changedPaths, [".env*", "apps/worker/**"])).toEqual([
      ".env.local",
      "apps/worker/src/main.ts",
      ".env.local",
    ]);
  });

  it("uses lexical POSIX-style matching without normalizing traversal or separators", () => {
    const changedPaths = [
      "nested/../.env.local",
      "../.env.local",
      "apps\\worker\\src\\main.ts",
      "apps/worker/src/main.ts",
    ];

    expect(findProtectedPathMatches(changedPaths, [".env*", "apps/worker/**"])).toEqual([
      "apps/worker/src/main.ts",
    ]);
  });

  it("keeps command authorization and protected-path escalation as separate decisions", () => {
    expect(authorizeRuntimeCommands(runtime, "validate", [])).toEqual([
      { executable: "pnpm", args: ["validate"] },
    ]);
    expect(findProtectedPathMatches(["apps/worker/src/main.ts"], ["apps/worker/**"])).toEqual([
      "apps/worker/src/main.ts",
    ]);
  });
});
