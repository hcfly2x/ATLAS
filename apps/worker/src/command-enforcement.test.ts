import { describe, expect, it } from "vitest";

import { decideEnforcement, type EnforcementCommand } from "@atlas/core";
import { canonicalPayloadHash, type WorkerAssignment, type WorkerRuntime } from "@atlas/shared";

import { CommandNotAllowedError, authorizeRuntimeCommands } from "./allowlist.js";
import {
  CommandEnforcementDeniedError,
  authorizeCommandsWithEnforcement,
  authorizeRuntimeCommandsWithEnforcement,
  evaluateCommandEnforcement,
  type CommandEnforcementLog,
} from "./command-enforcement.js";

const context = {
  executionId: "10000000-0000-4000-8000-000000000002",
  taskId: "10000000-0000-4000-8000-000000000001",
} as const;
const pnpmValidate = { args: ["validate"], executable: "pnpm" } as const;
const gsedVersion = { args: ["--version"], executable: "gsed" } as const;

function mutable(command: EnforcementCommand): { args: string[]; executable: string } {
  return { args: [...command.args], executable: command.executable };
}

function runtimeFor(
  requested: readonly EnforcementCommand[],
  allowed: readonly EnforcementCommand[],
  forbidden: readonly EnforcementCommand[] = [],
): WorkerRuntime {
  return {
    allowed_commands: allowed.map(mutable),
    bootstrap: requested.map(mutable),
    forbidden_commands: forbidden.map(mutable),
    package_manager: "custom",
    timeout_minutes: 10,
    validate: [],
  };
}

function assignmentFor(
  commands: readonly string[],
  allowedCommands: readonly EnforcementCommand[],
  gnuTools: readonly string[] = [],
): WorkerAssignment {
  const specification = {
    acceptance_criteria: ["deterministic enforcement is authoritative"],
    allowed_commands: [...commands],
    approval_required_for: [],
    authorized_scope: ["apps/worker/**"],
    constraints: [],
    context: [],
    delivery_mode: "repository_change" as const,
    expected_delivery: "tests",
    implementation_strategy: ["cut over command enforcement"],
    objective: "enforce commands deterministically",
    out_of_scope: [],
    project_id: "atlas",
    required_tests: ["command enforcement"],
    risk_level: "moderate" as const,
    task_id: context.taskId,
    version: 1,
  };
  return {
    allowed_commands: allowedCommands.map(mutable),
    autonomy_level: 2,
    execution_id: context.executionId,
    fencing_token: "1",
    lease_expires_at: "2026-07-29T23:59:59.000Z",
    lease_id: "10000000-0000-4000-8000-000000000003",
    project_id: "atlas",
    protected_globs: [],
    repository_path: "/tmp/atlas-command-cutover",
    required_tools: { codex_cli: null, git: null, gnu_tools: [...gnuTools], node: null },
    runtime: null,
    specification,
    specification_hash: canonicalPayloadHash(specification),
    specification_id: "10000000-0000-4000-8000-000000000004",
    specification_version: 1,
    task_id: specification.task_id,
  };
}

const corpus = [
  {
    allowed: [pnpmValidate],
    forbidden: [],
    gnuTools: [],
    label: "exact allowlist",
    requested: pnpmValidate,
  },
  {
    allowed: [pnpmValidate],
    forbidden: [],
    gnuTools: [],
    label: "arguments outside allowlist",
    requested: { args: ["validate", "--fix"], executable: "pnpm" },
  },
  {
    allowed: [{ args: ["validate", "&&"], executable: "pnpm" }],
    forbidden: [],
    gnuTools: [],
    label: "unsafe token",
    requested: { args: ["validate", "&&"], executable: "pnpm" },
  },
  {
    allowed: [pnpmValidate],
    forbidden: [pnpmValidate],
    gnuTools: [],
    label: "exact forbidden",
    requested: pnpmValidate,
  },
  {
    allowed: [pnpmValidate],
    forbidden: [{ args: [], executable: "pnpm" }],
    gnuTools: [],
    label: "executable-wide forbidden",
    requested: pnpmValidate,
  },
  {
    allowed: [gsedVersion],
    forbidden: [],
    gnuTools: ["gsed"],
    label: "declared GNU tool",
    requested: gsedVersion,
  },
  {
    allowed: [gsedVersion],
    forbidden: [],
    gnuTools: [],
    label: "undeclared GNU tool",
    requested: gsedVersion,
  },
] as const;

describe("authoritative command enforcement", () => {
  it.each(corpus)("matches the legacy result for $label", (input) => {
    const runtime = runtimeFor([input.requested], input.allowed, input.forbidden);
    const before = structuredClone(runtime);
    const logs: CommandEnforcementLog[] = [];
    let legacyAllowed = true;
    try {
      authorizeRuntimeCommands(runtime, "bootstrap", input.gnuTools);
    } catch (error) {
      expect(error).toBeInstanceOf(CommandNotAllowedError);
      legacyAllowed = false;
    }

    const enforced = () =>
      authorizeRuntimeCommandsWithEnforcement(runtime, "bootstrap", input.gnuTools, {
        ...context,
        log: (entry) => logs.push(entry),
      });

    if (legacyAllowed) {
      expect(enforced()).toEqual([input.requested]);
    } else {
      expect(enforced).toThrow(CommandEnforcementDeniedError);
    }
    expect(runtime).toEqual(before);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      divergence: "none",
      event: "worker.command_enforcement.evaluated",
      executable: input.requested.executable,
      source: "deterministic",
    });
  });

  it("keeps the legacy denial as a fail-closed guard against MORE_PERMISSIVE", () => {
    const logs: CommandEnforcementLog[] = [];
    const artificialAllow = decideEnforcement({
      action: "execute_command",
      allowedCommands: [pnpmValidate],
      changedPaths: [],
      command: pnpmValidate,
      forbiddenCommands: [],
      gnuOnlyExecutables: [],
      gnuTools: [],
      protectedGlobs: [],
    });
    const evaluation = evaluateCommandEnforcement(pnpmValidate, [], [], [], "deny", {
      ...context,
      decide: () => artificialAllow,
      log: (entry) => logs.push(entry),
    });

    expect(evaluation).toMatchObject({
      decision: "deny",
      deterministicDecision: "allow",
      divergence: "MORE_PERMISSIVE",
      reasonCode: "legacy_fallback",
      source: "legacy_fallback",
    });
    expect(logs[0]).toMatchObject({ divergence: "MORE_PERMISSIVE", level: "error" });
  });

  it("makes a stricter deterministic denial authoritative", () => {
    const artificialDeny = decideEnforcement({
      action: "execute_command",
      allowedCommands: [],
      changedPaths: [],
      command: pnpmValidate,
      forbiddenCommands: [],
      gnuOnlyExecutables: [],
      gnuTools: [],
      protectedGlobs: [],
    });

    const evaluation = evaluateCommandEnforcement(pnpmValidate, [pnpmValidate], [], [], "allow", {
      ...context,
      decide: () => artificialDeny,
      log: () => undefined,
    });

    expect(evaluation).toMatchObject({
      decision: "deny",
      deterministicDecision: "deny",
      divergence: "stricter",
      source: "deterministic",
    });
  });

  it("never executes a command when the deterministic decision requires a human", () => {
    const artificialHuman = decideEnforcement({
      action: "open_pull_request",
      allowedCommands: [],
      changedPaths: [".env.local"],
      forbiddenCommands: [],
      protectedGlobs: [".env*"],
    });

    const evaluation = evaluateCommandEnforcement(pnpmValidate, [pnpmValidate], [], [], "allow", {
      ...context,
      decide: () => artificialHuman,
      log: () => undefined,
    });

    expect(evaluation).toMatchObject({
      decision: "deny",
      deterministicDecision: "require_human",
      divergence: "stricter",
      source: "deterministic",
    });
  });

  it("fails closed when deterministic enforcement is unavailable", () => {
    const logs: CommandEnforcementLog[] = [];
    const runtime = runtimeFor([pnpmValidate], [pnpmValidate]);

    expect(() =>
      authorizeRuntimeCommandsWithEnforcement(runtime, "bootstrap", [], {
        ...context,
        decide: () => {
          throw new Error("simulated decision failure");
        },
        log: (entry) => logs.push(entry),
      }),
    ).toThrow(CommandEnforcementDeniedError);
    expect(logs[0]).toMatchObject({
      decision: "deny",
      divergence: "stricter",
      level: "error",
      reasonCode: "deterministic_failure",
      source: "deterministic_failure",
    });
  });

  it("does not let a logger failure change an allowed decision", () => {
    const runtime = runtimeFor([pnpmValidate], [pnpmValidate]);

    expect(
      authorizeRuntimeCommandsWithEnforcement(runtime, "bootstrap", [], {
        ...context,
        log: () => {
          throw new Error("simulated logger failure");
        },
      }),
    ).toEqual([pnpmValidate]);
  });

  it("classifies each command in a mixed batch without executing a denied one", () => {
    const denied = { args: ["test"], executable: "pnpm" } as const;
    const runtime = runtimeFor([pnpmValidate, denied], [pnpmValidate]);
    const logs: CommandEnforcementLog[] = [];

    expect(() =>
      authorizeRuntimeCommandsWithEnforcement(runtime, "bootstrap", [], {
        ...context,
        log: (entry) => logs.push(entry),
      }),
    ).toThrow(CommandEnforcementDeniedError);
    expect(logs).toMatchObject([
      { decision: "allow", divergence: "none" },
      { decision: "deny", divergence: "none" },
    ]);
  });

  it("does not log raw arguments or manifest command lists", () => {
    const sensitiveArgument = "SECRETVAL_must_not_appear";
    const command = { args: [sensitiveArgument], executable: "tool" } as const;
    const runtime = runtimeFor([command], [command]);
    const logs: CommandEnforcementLog[] = [];

    authorizeRuntimeCommandsWithEnforcement(runtime, "bootstrap", [], {
      ...context,
      log: (entry) => logs.push(entry),
    });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(sensitiveArgument);
    expect(serialized).not.toContain('"args"');
    expect(serialized).not.toContain("allowedCommands");
    expect(serialized).not.toContain("forbiddenCommands");
    expect(logs[0]).toHaveProperty("inputHash");
    expect(logs[0]).toHaveProperty("decisionHash");
  });

  it("keeps parsing in the specification caller and authorizes structured output", () => {
    const assignment = assignmentFor(["pnpm validate"], [pnpmValidate]);
    const logs: CommandEnforcementLog[] = [];

    expect(
      authorizeCommandsWithEnforcement(assignment, {
        ...context,
        log: (entry) => logs.push(entry),
      }),
    ).toEqual([pnpmValidate]);
    expect(logs[0]).toMatchObject({
      decision: "allow",
      divergence: "none",
      executable: "pnpm",
    });
  });

  it("preserves parsing denial without logging the raw command", () => {
    const raw = "pnpm validate && SECRETVAL";
    const assignment = assignmentFor([raw], [pnpmValidate]);
    const logs: CommandEnforcementLog[] = [];

    expect(() =>
      authorizeCommandsWithEnforcement(assignment, {
        ...context,
        log: (entry) => logs.push(entry),
      }),
    ).toThrow(CommandNotAllowedError);
    expect(JSON.stringify(logs)).not.toContain(raw);
    expect(logs).toEqual([
      {
        event: "worker.command_enforcement.failed",
        executionId: context.executionId,
        level: "error",
        service: "worker",
        taskId: context.taskId,
      },
    ]);
  });
});
