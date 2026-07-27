import { describe, expect, it } from "vitest";

import { ENFORCEMENT_REASON_CODES, decideEnforcement, type EnforcementCommand } from "@atlas/core";
import { canonicalPayloadHash, type WorkerAssignment, type WorkerRuntime } from "@atlas/shared";

import {
  CommandNotAllowedError,
  authorizeCommands,
  authorizeRuntimeCommands,
  parseSpecificationCommand,
} from "./allowlist.js";

const GNU_ONLY_EXECUTABLES = [
  "gdate",
  "gfind",
  "ggrep",
  "greadlink",
  "gsed",
  "gstat",
  "gxargs",
] as const;

interface CommandCase {
  readonly allowedCommands: readonly EnforcementCommand[];
  readonly command: EnforcementCommand;
  readonly forbiddenCommands: readonly EnforcementCommand[];
  readonly gnuTools: readonly string[];
  readonly label: string;
}

function mutableCommand(command: EnforcementCommand): { executable: string; args: string[] } {
  return { args: [...command.args], executable: command.executable };
}

function runtimeFor(input: CommandCase): WorkerRuntime {
  return {
    allowed_commands: input.allowedCommands.map(mutableCommand),
    bootstrap: [],
    forbidden_commands: input.forbiddenCommands.map(mutableCommand),
    package_manager: "custom",
    timeout_minutes: 10,
    validate: [mutableCommand(input.command)],
  };
}

function legacyAllows(input: CommandCase): boolean {
  try {
    authorizeRuntimeCommands(runtimeFor(input), "validate", input.gnuTools);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandNotAllowedError);
    return false;
  }
}

function pureDecision(input: CommandCase) {
  return decideEnforcement({
    action: "execute_command",
    allowedCommands: input.allowedCommands,
    changedPaths: [],
    command: input.command,
    forbiddenCommands: input.forbiddenCommands,
    gnuOnlyExecutables: GNU_ONLY_EXECUTABLES,
    gnuTools: input.gnuTools,
    protectedGlobs: [],
  });
}

const pnpmValidate = { executable: "pnpm", args: ["validate"] } as const;
const gsedVersion = { executable: "gsed", args: ["--version"] } as const;
const corpus: readonly CommandCase[] = [
  {
    allowedCommands: [pnpmValidate],
    command: pnpmValidate,
    forbiddenCommands: [],
    gnuTools: [],
    label: "exact allowlist match",
  },
  {
    allowedCommands: [pnpmValidate],
    command: { executable: "pnpm", args: ["validate", "--fix"] },
    forbiddenCommands: [],
    gnuTools: [],
    label: "arguments outside allowlist",
  },
  {
    allowedCommands: [{ executable: "pnpm", args: ["validate", "&&"] }],
    command: { executable: "pnpm", args: ["validate", "&&"] },
    forbiddenCommands: [],
    gnuTools: [],
    label: "unsafe shell token",
  },
  {
    allowedCommands: [pnpmValidate],
    command: pnpmValidate,
    forbiddenCommands: [pnpmValidate],
    gnuTools: [],
    label: "exact forbidden command",
  },
  {
    allowedCommands: [pnpmValidate],
    command: pnpmValidate,
    forbiddenCommands: [{ executable: "pnpm", args: [] }],
    gnuTools: [],
    label: "executable-wide forbidden command",
  },
  {
    allowedCommands: [gsedVersion],
    command: gsedVersion,
    forbiddenCommands: [],
    gnuTools: ["gsed"],
    label: "declared GNU-only tool",
  },
  {
    allowedCommands: [gsedVersion],
    command: gsedVersion,
    forbiddenCommands: [],
    gnuTools: [],
    label: "undeclared GNU-only tool",
  },
];

function assignmentFor(
  command: string,
  allowedCommands: readonly EnforcementCommand[],
  gnuTools: readonly string[],
): WorkerAssignment {
  const specification = {
    acceptance_criteria: ["command is authorized deterministically"],
    allowed_commands: [command],
    approval_required_for: [],
    authorized_scope: ["packages/core/**"],
    constraints: [],
    context: [],
    delivery_mode: "repository_change" as const,
    expected_delivery: "tests",
    implementation_strategy: ["characterize command authorization"],
    objective: "prove command authorization parity",
    out_of_scope: [],
    project_id: "atlas",
    required_tests: ["command parity"],
    risk_level: "moderate" as const,
    task_id: "10000000-0000-4000-8000-000000000001",
    version: 1,
  };
  return {
    allowed_commands: allowedCommands.map(mutableCommand),
    autonomy_level: 2,
    execution_id: "10000000-0000-4000-8000-000000000002",
    fencing_token: "1",
    lease_expires_at: "2026-07-27T23:59:59.000Z",
    lease_id: "10000000-0000-4000-8000-000000000003",
    project_id: "atlas",
    protected_globs: [],
    repository_path: "/tmp/atlas-command-parity",
    required_tools: { codex_cli: null, git: null, gnu_tools: [...gnuTools], node: null },
    runtime: null,
    specification,
    specification_hash: canonicalPayloadHash(specification),
    specification_id: "10000000-0000-4000-8000-000000000004",
    specification_version: 1,
    task_id: specification.task_id,
  };
}

describe("pure command enforcement parity with the legacy authorizers", () => {
  it.each(corpus)("matches the legacy authorization outcome for $label", (input) => {
    const legacyAllowed = legacyAllows(input);
    const decision = pureDecision(input);

    expect(decision.decision === "allow").toBe(legacyAllowed);
    if (legacyAllowed) {
      expect(authorizeRuntimeCommands(runtimeFor(input), "validate", input.gnuTools)).toEqual([
        input.command,
      ]);
      expect(decision.evidence.command).toEqual(input.command);
    }
  });

  it("never allows a corpus command denied by the legacy authorizer", () => {
    for (const input of corpus) {
      const legacyAllowed = legacyAllows(input);
      const newAllowed = pureDecision(input).decision === "allow";

      expect(newAllowed && !legacyAllowed, input.label).toBe(false);
    }
  });

  it("preserves GNU-gate precedence before forbidden and allowlist decisions", () => {
    const decision = pureDecision({
      allowedCommands: [gsedVersion],
      command: gsedVersion,
      forbiddenCommands: [gsedVersion],
      gnuTools: [],
      label: "GNU precedence",
    });

    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.COMMAND_GNU_TOOL_NOT_DECLARED);
  });

  it("produces identical decisions and hashes for equivalent reordered configuration", () => {
    const first = decideEnforcement({
      action: "execute_command",
      allowedCommands: [gsedVersion, pnpmValidate, gsedVersion],
      changedPaths: [],
      command: gsedVersion,
      forbiddenCommands: [],
      gnuOnlyExecutables: [...GNU_ONLY_EXECUTABLES].reverse(),
      gnuTools: ["gsed", "gsed"],
      protectedGlobs: [],
    });
    const second = decideEnforcement({
      action: "execute_command",
      allowedCommands: [pnpmValidate, gsedVersion],
      changedPaths: [],
      command: gsedVersion,
      forbiddenCommands: [],
      gnuOnlyExecutables: GNU_ONLY_EXECUTABLES,
      gnuTools: ["gsed"],
      protectedGlobs: [],
    });

    expect(first).toEqual(second);
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.decisionHash).toBe(second.decisionHash);
  });

  it("keeps specification string parsing in the caller and matches its structured command", () => {
    const command = parseSpecificationCommand("pnpm validate");
    const assignment = assignmentFor("pnpm validate", [command], []);

    expect(authorizeCommands(assignment)).toEqual([command]);
    expect(
      pureDecision({
        allowedCommands: [command],
        command,
        forbiddenCommands: [],
        gnuTools: [],
        label: "specification command",
      }).decision,
    ).toBe("allow");
    expect(() => parseSpecificationCommand("pnpm validate && deploy")).toThrow(
      CommandNotAllowedError,
    );
  });

  it("applies the same GNU gate to specification commands", () => {
    const assignment = assignmentFor("gsed --version", [gsedVersion], []);

    expect(() => authorizeCommands(assignment)).toThrow(CommandNotAllowedError);
    expect(
      pureDecision({
        allowedCommands: [gsedVersion],
        command: gsedVersion,
        forbiddenCommands: [],
        gnuTools: [],
        label: "specification GNU command",
      }).reasonCode,
    ).toBe(ENFORCEMENT_REASON_CODES.COMMAND_GNU_TOOL_NOT_DECLARED);
  });
});
