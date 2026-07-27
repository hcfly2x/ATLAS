import { describe, expect, it } from "vitest";

import { decideEnforcement } from "@atlas/core";

import {
  findProtectedPathMatchesWithShadow,
  type ProtectedPathShadowLog,
} from "./protected-path-shadow.js";
import { findProtectedPathMatches } from "./protected-paths.js";

const protectedGlobs = [".env*", "apps/worker/**"] as const;
const shadowContext = {
  executionId: "10000000-0000-4000-8000-000000000002",
  taskId: "10000000-0000-4000-8000-000000000001",
} as const;

const corpus = [
  {
    changedPaths: ["docs/readme.md"],
    expectedDivergence: "none",
    label: "common unprotected path",
  },
  {
    changedPaths: [".env.local"],
    expectedDivergence: "none",
    label: "root protected path",
  },
  {
    changedPaths: [".ENV.local"],
    expectedDivergence: "stricter",
    label: "case variant",
  },
  {
    changedPaths: ["nested/../.env.local"],
    expectedDivergence: "stricter",
    label: "internal traversal",
  },
  {
    changedPaths: ["../.env.local"],
    expectedDivergence: "stricter",
    label: "external traversal",
  },
  {
    changedPaths: ["/tmp/.env.local"],
    expectedDivergence: "stricter",
    label: "absolute path",
  },
  {
    changedPaths: ["apps\\worker\\src\\main.ts"],
    expectedDivergence: "stricter",
    label: "non-POSIX separator",
  },
  {
    changedPaths: ["./.env.local", ".env.local", "./.env.local"],
    expectedDivergence: "none",
    label: "equivalent duplicates",
  },
] as const;

describe("protected-path shadow caller", () => {
  it.each(corpus)(
    "keeps legacy output byte-identical for $label",
    ({ changedPaths, expectedDivergence }) => {
      const pathsBefore = structuredClone(changedPaths);
      const globsBefore = structuredClone(protectedGlobs);
      const logs: ProtectedPathShadowLog[] = [];
      const legacy = findProtectedPathMatches(changedPaths, protectedGlobs);

      const observed = findProtectedPathMatchesWithShadow(changedPaths, protectedGlobs, {
        ...shadowContext,
        log: (entry) => logs.push(entry),
      });

      expect(JSON.stringify(observed)).toBe(JSON.stringify(legacy));
      expect(changedPaths).toEqual(pathsBefore);
      expect(protectedGlobs).toEqual(globsBefore);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        divergence: expectedDivergence,
        event: "worker.protected_path_shadow.evaluated",
      });
      expect(logs[0]).not.toMatchObject({ divergence: "MORE_PERMISSIVE" });
    },
  );

  it("logs the required decision fields for a successful evaluation", () => {
    const logs: ProtectedPathShadowLog[] = [];

    findProtectedPathMatchesWithShadow([".env.local"], protectedGlobs, {
      ...shadowContext,
      log: (entry) => logs.push(entry),
    });

    expect(logs[0]).toMatchObject({
      authoritativeDecision: "require_human",
      decision: "require_human",
      divergence: "none",
      event: "worker.protected_path_shadow.evaluated",
      executionId: shadowContext.executionId,
      level: "info",
      reasonCode: "path_protected",
      service: "worker",
      taskId: shadowContext.taskId,
    });
    expect(logs[0]).toHaveProperty("inputHash");
    expect(logs[0]).toHaveProperty("decisionHash");
  });

  it("detects a more-permissive shadow without changing the authoritative output", () => {
    const logs: ProtectedPathShadowLog[] = [];
    const artificialAllow = decideEnforcement({
      action: "open_pull_request",
      allowedCommands: [],
      changedPaths: ["docs/readme.md"],
      forbiddenCommands: [],
      protectedGlobs,
    });
    const legacy = findProtectedPathMatches([".env.local"], protectedGlobs);

    const observed = findProtectedPathMatchesWithShadow([".env.local"], protectedGlobs, {
      ...shadowContext,
      decide: () => artificialAllow,
      log: (entry) => logs.push(entry),
    });

    expect(observed).toEqual(legacy);
    expect(logs[0]).toMatchObject({
      divergence: "MORE_PERMISSIVE",
      level: "error",
    });
  });

  it("fails safely when the shadow decision throws", () => {
    const logs: ProtectedPathShadowLog[] = [];
    const changedPaths = [".env.local"];
    const legacy = findProtectedPathMatches(changedPaths, protectedGlobs);

    const observed = findProtectedPathMatchesWithShadow(changedPaths, protectedGlobs, {
      ...shadowContext,
      decide: () => {
        throw new Error("simulated shadow failure");
      },
      log: (entry) => logs.push(entry),
    });

    expect(observed).toEqual(legacy);
    expect(logs).toEqual([
      {
        event: "worker.protected_path_shadow.failed",
        executionId: shadowContext.executionId,
        level: "error",
        service: "worker",
        taskId: shadowContext.taskId,
      },
    ]);
  });

  it("fails safely when the structured logger throws", () => {
    const changedPaths = [".env.local"];
    const legacy = findProtectedPathMatches(changedPaths, protectedGlobs);

    expect(
      findProtectedPathMatchesWithShadow(changedPaths, protectedGlobs, {
        ...shadowContext,
        log: () => {
          throw new Error("simulated logger failure");
        },
      }),
    ).toEqual(legacy);
  });
});
