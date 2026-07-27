import { describe, expect, it } from "vitest";

import { decideEnforcement } from "@atlas/core";

import {
  assertProtectedPathEnforcementAllowsResult,
  evaluateProtectedPaths,
  ProtectedPathEnforcementDeniedError,
  type ProtectedPathEnforcementLog,
} from "./protected-path-enforcement.js";

const protectedGlobs = [".env*", "apps/worker/**"] as const;
const shadowContext = {
  executionId: "10000000-0000-4000-8000-000000000002",
  taskId: "10000000-0000-4000-8000-000000000001",
} as const;

const corpus = [
  {
    changedPaths: ["docs/readme.md"],
    expectedDecision: "allow",
    expectedDivergence: "none",
    expectedMatches: [],
    label: "common unprotected path",
  },
  {
    changedPaths: [".env.local"],
    expectedDecision: "require_human",
    expectedDivergence: "none",
    expectedMatches: [".env.local"],
    label: "root protected path",
  },
  {
    changedPaths: [".ENV.local"],
    expectedDecision: "require_human",
    expectedDivergence: "stricter",
    expectedMatches: [".ENV.local"],
    label: "case variant",
  },
  {
    changedPaths: ["nested/../.env.local"],
    expectedDecision: "require_human",
    expectedDivergence: "stricter",
    expectedMatches: [".env.local"],
    label: "internal traversal",
  },
  {
    changedPaths: ["../.env.local"],
    expectedDecision: "deny",
    expectedDivergence: "stricter",
    expectedMatches: ["../.env.local"],
    label: "external traversal",
  },
  {
    changedPaths: ["/tmp/.env.local"],
    expectedDecision: "deny",
    expectedDivergence: "stricter",
    expectedMatches: ["/tmp/.env.local"],
    label: "absolute path",
  },
  {
    changedPaths: ["apps\\worker\\src\\main.ts"],
    expectedDecision: "deny",
    expectedDivergence: "stricter",
    expectedMatches: ["apps\\worker\\src\\main.ts"],
    label: "non-POSIX separator",
  },
  {
    changedPaths: ["./.env.local", ".env.local", "./.env.local"],
    expectedDecision: "require_human",
    expectedDivergence: "none",
    expectedMatches: [".env.local"],
    label: "equivalent duplicates",
  },
] as const;

describe("protected-path enforcement caller", () => {
  it.each(corpus)(
    "uses deterministic enforcement for $label",
    ({ changedPaths, expectedDecision, expectedDivergence, expectedMatches }) => {
      const pathsBefore = structuredClone(changedPaths);
      const globsBefore = structuredClone(protectedGlobs);
      const logs: ProtectedPathEnforcementLog[] = [];

      const observed = evaluateProtectedPaths(changedPaths, protectedGlobs, {
        ...shadowContext,
        log: (entry) => logs.push(entry),
      });

      expect(observed).toMatchObject({
        decision: expectedDecision,
        divergence: expectedDivergence,
        matches: expectedMatches,
        source: "deterministic",
      });
      expect(changedPaths).toEqual(pathsBefore);
      expect(protectedGlobs).toEqual(globsBefore);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        decision: expectedDecision,
        divergence: expectedDivergence,
        event: "worker.protected_path_enforcement.evaluated",
        source: "deterministic",
      });
      expect(logs[0]).not.toMatchObject({ divergence: "MORE_PERMISSIVE" });
    },
  );

  it("logs the required decision fields for a successful evaluation", () => {
    const logs: ProtectedPathEnforcementLog[] = [];

    evaluateProtectedPaths([".env.local"], protectedGlobs, {
      ...shadowContext,
      log: (entry) => logs.push(entry),
    });

    expect(logs[0]).toMatchObject({
      authoritativeDecision: "require_human",
      decision: "require_human",
      divergence: "none",
      event: "worker.protected_path_enforcement.evaluated",
      executionId: shadowContext.executionId,
      level: "info",
      reasonCode: "path_protected",
      service: "worker",
      source: "deterministic",
      taskId: shadowContext.taskId,
    });
    expect(logs[0]).toHaveProperty("inputHash");
    expect(logs[0]).toHaveProperty("decisionHash");
  });

  it("falls back to the legacy result when deterministic enforcement is more permissive", () => {
    const logs: ProtectedPathEnforcementLog[] = [];
    const artificialAllow = decideEnforcement({
      action: "open_pull_request",
      allowedCommands: [],
      changedPaths: ["docs/readme.md"],
      forbiddenCommands: [],
      protectedGlobs,
    });

    const observed = evaluateProtectedPaths([".env.local"], protectedGlobs, {
      ...shadowContext,
      decide: () => artificialAllow,
      log: (entry) => logs.push(entry),
    });

    expect(observed).toMatchObject({
      decision: "require_human",
      divergence: "MORE_PERMISSIVE",
      matches: [".env.local"],
      reasonCode: "legacy_fallback",
      source: "legacy_fallback",
    });
    expect(logs[0]).toMatchObject({
      divergence: "MORE_PERMISSIVE",
      level: "error",
      source: "legacy_fallback",
    });
  });

  it("falls back to the legacy result when deterministic enforcement throws", () => {
    const logs: ProtectedPathEnforcementLog[] = [];
    const changedPaths = [".env.local"];

    const observed = evaluateProtectedPaths(changedPaths, protectedGlobs, {
      ...shadowContext,
      decide: () => {
        throw new Error("simulated deterministic failure");
      },
      log: (entry) => logs.push(entry),
    });

    expect(observed).toMatchObject({
      decision: "require_human",
      matches: [".env.local"],
      reasonCode: "legacy_fallback",
      source: "legacy_fallback",
    });
    expect(logs[0]).toMatchObject({ level: "error", source: "legacy_fallback" });
  });

  it("denies when deterministic enforcement throws and legacy would allow", () => {
    const logs: ProtectedPathEnforcementLog[] = [];
    const observed = evaluateProtectedPaths(["docs/readme.md"], protectedGlobs, {
      ...shadowContext,
      decide: () => {
        throw new Error("simulated deterministic failure");
      },
      log: (entry) => logs.push(entry),
    });

    expect(observed).toMatchObject({
      decision: "deny",
      divergence: "stricter",
      matches: ["docs/readme.md"],
      reasonCode: "legacy_fallback",
      source: "legacy_fallback",
    });
    expect(logs[0]).toMatchObject({
      authoritativeDecision: "allow",
      decision: "deny",
      level: "error",
      source: "legacy_fallback",
    });
  });

  it("fails safely when the structured logger throws", () => {
    const changedPaths = [".env.local"];

    expect(
      evaluateProtectedPaths(changedPaths, protectedGlobs, {
        ...shadowContext,
        log: () => {
          throw new Error("simulated logger failure");
        },
      }),
    ).toMatchObject({ decision: "require_human", matches: [".env.local"] });
  });

  it("allows an empty diff without calling the decision function", () => {
    const logs: ProtectedPathEnforcementLog[] = [];
    const observed = evaluateProtectedPaths([], protectedGlobs, {
      ...shadowContext,
      decide: () => {
        throw new Error("empty diff must not call deterministic enforcement");
      },
      log: (entry) => logs.push(entry),
    });

    expect(observed).toMatchObject({
      decision: "allow",
      divergence: "none",
      matches: [],
      reasonCode: "empty_diff",
      source: "empty_diff",
    });
    expect(observed.inputHash).toMatch(/^sha256:/);
    expect(observed.decisionHash).toMatch(/^sha256:/);
    expect(logs[0]).toMatchObject({
      decision: "allow",
      reasonCode: "empty_diff",
      source: "empty_diff",
    });
  });

  it("produces stable hashes for repeated empty-diff inputs", () => {
    const first = evaluateProtectedPaths([], [...protectedGlobs].reverse(), {
      ...shadowContext,
      log: () => undefined,
    });
    const second = evaluateProtectedPaths([], protectedGlobs, {
      ...shadowContext,
      log: () => undefined,
    });

    expect(first.inputHash).toBe(second.inputHash);
    expect(first.decisionHash).toBe(second.decisionHash);
  });

  it("turns a double evaluator failure into a deterministic deny", () => {
    const logs: ProtectedPathEnforcementLog[] = [];
    const observed = evaluateProtectedPaths(["../escape"], protectedGlobs, {
      ...shadowContext,
      decide: () => {
        throw new Error("deterministic unavailable");
      },
      legacyMatch: () => {
        throw new Error("legacy unavailable");
      },
      log: (entry) => logs.push(entry),
    });

    expect(observed).toMatchObject({
      decision: "deny",
      matches: ["../escape"],
      reasonCode: "invalid_input",
      source: "deterministic",
    });
    expect(logs).toEqual([
      {
        event: "worker.protected_path_enforcement.failed",
        executionId: shadowContext.executionId,
        level: "error",
        service: "worker",
        taskId: shadowContext.taskId,
      },
    ]);
  });

  it("throws a typed error only for a deny result", () => {
    const denied = evaluateProtectedPaths(["../escape"], protectedGlobs, {
      ...shadowContext,
      log: () => undefined,
    });
    const allowed = evaluateProtectedPaths(["docs/readme.md"], protectedGlobs, {
      ...shadowContext,
      log: () => undefined,
    });

    expect(() => {
      assertProtectedPathEnforcementAllowsResult(denied);
    }).toThrow(ProtectedPathEnforcementDeniedError);
    expect(() => {
      assertProtectedPathEnforcementAllowsResult(allowed);
    }).not.toThrow();
  });
});
