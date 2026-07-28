import { describe, expect, it } from "vitest";

import { decideEnforcement, type EnforcementCommand } from "@atlas/core";
import { canonicalPayloadHash, type WorkerAssignment, type WorkerRuntime } from "@atlas/shared";

import {
  CommandNotAllowedError,
  authorizeCommands,
  authorizeRuntimeCommands,
} from "./allowlist.js";
import {
  authorizeCommandsWithShadow,
  authorizeRuntimeCommandsWithShadow,
  type CommandEnforcementShadowLog,
} from "./command-enforcement-shadow.js";

const shadowContext = {
  executionId: "10000000-0000-4000-8000-000000000002",
  taskId: "10000000-0000-4000-8000-000000000001",
} as const;

const pnpmValidate = { args: ["validate"], executable: "pnpm" } as const;
const gsedVersion = { args: ["--version"], executable: "gsed" } as const;

function mutableCommand(command: EnforcementCommand): { args: string[]; executable: string } {
  return { args: [...command.args], executable: command.executable };
}

function runtimeFor(
  requested: readonly EnforcementCommand[],
  allowed: readonly EnforcementCommand[],
  forbidden: readonly EnforcementCommand[] = [],
): WorkerRuntime {
  return {
    allowed_commands: allowed.map(mutableCommand),
    bootstrap: requested.map(mutableCommand),
    forbidden_commands: forbidden.map(mutableCommand),
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
    acceptance_criteria: ["command shadow is observational"],
    allowed_commands: [...commands],
    approval_required_for: [],
    authorized_scope: ["apps/worker/**"],
    constraints: [],
    context: [],
    delivery_mode: "repository_change" as const,
    expected_delivery: "tests",
    implementation_strategy: ["observe legacy command authorization"],
    objective: "prove command shadow parity",
    out_of_scope: [],
    project_id: "atlas",
    required_tests: ["command shadow"],
    risk_level: "moderate" as const,
    task_id: shadowContext.taskId,
    version: 1,
  };
  return {
    allowed_commands: allowedCommands.map(mutableCommand),
    autonomy_level: 2,
    execution_id: shadowContext.executionId,
    fencing_token: "1",
    lease_expires_at: "2026-07-28T23:59:59.000Z",
    lease_id: "10000000-0000-4000-8000-000000000003",
    project_id: "atlas",
    protected_globs: [],
    repository_path: "/tmp/atlas-command-shadow",
    required_tools: { codex_cli: null, git: null, gnu_tools: [...gnuTools], node: null },
    runtime: null,
    specification,
    specification_hash: canonicalPayloadHash(specification),
    specification_id: "10000000-0000-4000-8000-000000000004",
    specification_version: 1,
    task_id: specification.task_id,
  };
}

function capture<T>(run: () => T): { error?: unknown; result?: T } {
  try {
    return { result: run() };
  } catch (error) {
    return { error };
  }
}

const runtimeCorpus = [
  {
    allowed: [pnpmValidate],
    forbidden: [],
    gnuTools: [],
    label: "exact allowlist match",
    requested: [pnpmValidate],
  },
  {
    allowed: [pnpmValidate],
    forbidden: [],
    gnuTools: [],
    label: "arguments outside allowlist",
    requested: [{ args: ["validate", "--fix"], executable: "pnpm" }],
  },
  {
    allowed: [{ args: ["validate", "&&"], executable: "pnpm" }],
    forbidden: [],
    gnuTools: [],
    label: "unsafe shell token",
    requested: [{ args: ["validate", "&&"], executable: "pnpm" }],
  },
  {
    allowed: [pnpmValidate],
    forbidden: [pnpmValidate],
    gnuTools: [],
    label: "exact forbidden command",
    requested: [pnpmValidate],
  },
  {
    allowed: [pnpmValidate],
    forbidden: [{ args: [], executable: "pnpm" }],
    gnuTools: [],
    label: "executable-wide forbidden command",
    requested: [pnpmValidate],
  },
  {
    allowed: [gsedVersion],
    forbidden: [],
    gnuTools: ["gsed"],
    label: "declared GNU-only tool",
    requested: [gsedVersion],
  },
  {
    allowed: [gsedVersion],
    forbidden: [],
    gnuTools: [],
    label: "undeclared GNU-only tool",
    requested: [gsedVersion],
  },
] as const;

describe("command-enforcement shadow caller", () => {
  it.each(runtimeCorpus)(
    "keeps the runtime legacy outcome authoritative for $label",
    ({ allowed, forbidden, gnuTools, requested }) => {
      const runtime = runtimeFor(requested, allowed, forbidden);
      const before = structuredClone(runtime);
      const legacy = capture(() => authorizeRuntimeCommands(runtime, "bootstrap", gnuTools));
      const logs: CommandEnforcementShadowLog[] = [];
      const observed = capture(() =>
        authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", gnuTools, {
          ...shadowContext,
          log: (entry) => logs.push(entry),
        }),
      );

      expect(JSON.stringify(observed.result)).toBe(JSON.stringify(legacy.result));
      expect(observed.error?.constructor).toBe(legacy.error?.constructor);
      expect((observed.error as Error | undefined)?.message).toBe(
        (legacy.error as Error | undefined)?.message,
      );
      expect(runtime).toEqual(before);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        divergence: "none",
        event: "worker.command_enforcement_shadow.evaluated",
        executable: requested[0].executable,
        level: "info",
      });
    },
  );

  it("classifies every requested command against its legacy command decision", () => {
    const denied = { args: ["test"], executable: "pnpm" } as const;
    const runtime = runtimeFor([pnpmValidate, denied], [pnpmValidate]);
    const logs: CommandEnforcementShadowLog[] = [];

    expect(() =>
      authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", [], {
        ...shadowContext,
        log: (entry) => logs.push(entry),
      }),
    ).toThrow(CommandNotAllowedError);

    expect(logs).toMatchObject([
      { authoritativeDecision: "allow", divergence: "none", executable: "pnpm" },
      { authoritativeDecision: "deny", divergence: "none", executable: "pnpm" },
    ]);
  });

  it("detects a more-permissive shadow and still preserves the legacy denial", () => {
    const runtime = runtimeFor([pnpmValidate], [], []);
    const logs: CommandEnforcementShadowLog[] = [];
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

    expect(() =>
      authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", [], {
        ...shadowContext,
        decide: () => artificialAllow,
        log: (entry) => logs.push(entry),
      }),
    ).toThrow(CommandNotAllowedError);
    expect(logs[0]).toMatchObject({
      authoritativeDecision: "deny",
      decision: "allow",
      divergence: "MORE_PERMISSIVE",
      level: "error",
    });
  });

  it("detects a stricter shadow and still returns the legacy authorization", () => {
    const runtime = runtimeFor([pnpmValidate], [pnpmValidate]);
    const logs: CommandEnforcementShadowLog[] = [];
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

    expect(
      authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", [], {
        ...shadowContext,
        decide: () => artificialDeny,
        log: (entry) => logs.push(entry),
      }),
    ).toEqual([pnpmValidate]);
    expect(logs[0]).toMatchObject({
      authoritativeDecision: "allow",
      decision: "deny",
      divergence: "stricter",
      level: "info",
    });
  });

  it("never logs raw arguments while retaining executable, hashes, and divergence", () => {
    const sensitiveArgument = "credential_value_must_not_appear";
    const command = { args: [sensitiveArgument], executable: "tool" } as const;
    const runtime = runtimeFor([command], [command]);
    const logs: CommandEnforcementShadowLog[] = [];

    authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", [], {
      ...shadowContext,
      log: (entry) => logs.push(entry),
    });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(sensitiveArgument);
    expect(serialized).not.toContain('"args"');
    expect(logs[0]).toMatchObject({
      divergence: "none",
      executable: "tool",
      executionId: shadowContext.executionId,
      service: "worker",
      taskId: shadowContext.taskId,
    });
    expect(logs[0]).toHaveProperty("inputHash");
    expect(logs[0]).toHaveProperty("decisionHash");
  });

  it("fails safely when the shadow decision throws", () => {
    const runtime = runtimeFor([pnpmValidate], [pnpmValidate]);
    const legacy = authorizeRuntimeCommands(runtime, "bootstrap", []);
    const logs: CommandEnforcementShadowLog[] = [];

    const observed = authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", [], {
      ...shadowContext,
      decide: () => {
        throw new Error("simulated shadow failure");
      },
      log: (entry) => logs.push(entry),
    });

    expect(observed).toEqual(legacy);
    expect(logs).toEqual([
      {
        event: "worker.command_enforcement_shadow.failed",
        executable: "pnpm",
        executionId: shadowContext.executionId,
        level: "error",
        service: "worker",
        taskId: shadowContext.taskId,
      },
    ]);
  });

  it("fails safely when the structured logger throws", () => {
    const runtime = runtimeFor([pnpmValidate], [pnpmValidate]);
    const legacy = authorizeRuntimeCommands(runtime, "bootstrap", []);

    expect(
      authorizeRuntimeCommandsWithShadow(runtime, "bootstrap", [], {
        ...shadowContext,
        log: () => {
          throw new Error("simulated logger failure");
        },
      }),
    ).toEqual(legacy);
  });

  it("keeps the specification legacy caller authoritative without moving parsing", () => {
    const assignment = assignmentFor(["pnpm validate"], [pnpmValidate]);
    const logs: CommandEnforcementShadowLog[] = [];

    expect(
      authorizeCommandsWithShadow(assignment, {
        ...shadowContext,
        log: (entry) => logs.push(entry),
      }),
    ).toEqual(authorizeCommands(assignment));
    expect(logs[0]).toMatchObject({
      authoritativeDecision: "allow",
      divergence: "none",
      executable: "pnpm",
    });
  });

  it("preserves a specification parsing denial and logs no raw command", () => {
    const unsafeCommand = "pnpm validate && sensitive_value";
    const assignment = assignmentFor([unsafeCommand], [pnpmValidate]);
    const logs: CommandEnforcementShadowLog[] = [];

    expect(() =>
      authorizeCommandsWithShadow(assignment, {
        ...shadowContext,
        log: (entry) => logs.push(entry),
      }),
    ).toThrow(CommandNotAllowedError);
    expect(JSON.stringify(logs)).not.toContain(unsafeCommand);
    expect(logs).toEqual([
      {
        event: "worker.command_enforcement_shadow.failed",
        executionId: shadowContext.executionId,
        level: "error",
        service: "worker",
        taskId: shadowContext.taskId,
      },
    ]);
  });
});
