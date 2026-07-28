import { decideEnforcement, type EnforcementDecision, type EnforcementInput } from "@atlas/core";
import type { WorkerAssignment, WorkerRuntime } from "@atlas/shared";

import {
  GNU_ONLY_EXECUTABLES,
  authorizeCommands,
  authorizeRuntimeCommands,
  parseSpecificationCommand,
  type AllowedCommand,
} from "./allowlist.js";

export type CommandShadowDivergence = "none" | "stricter" | "MORE_PERMISSIVE";

export type CommandEnforcementShadowLog =
  | {
      readonly authoritativeDecision: "allow" | "deny";
      readonly decision: EnforcementDecision["decision"];
      readonly decisionHash: string;
      readonly divergence: CommandShadowDivergence;
      readonly event: "worker.command_enforcement_shadow.evaluated";
      readonly executable: string;
      readonly executionId: string;
      readonly inputHash: string;
      readonly level: "error" | "info";
      readonly reasonCode: EnforcementDecision["reasonCode"];
      readonly service: "worker";
      readonly taskId: string;
    }
  | {
      readonly event: "worker.command_enforcement_shadow.failed";
      readonly executable?: string;
      readonly executionId: string;
      readonly level: "error";
      readonly service: "worker";
      readonly taskId: string;
    };

type ShadowDecision = Pick<
  EnforcementDecision,
  "decision" | "decisionHash" | "inputHash" | "reasonCode"
>;
type ShadowDecider = (input: EnforcementInput) => ShadowDecision;
type ShadowLogger = (entry: CommandEnforcementShadowLog) => void;

export interface CommandShadowOptions {
  readonly decide?: ShadowDecider;
  readonly executionId: string;
  readonly log?: ShadowLogger;
  readonly taskId: string;
}

const decisionStrictness = {
  allow: 0,
  require_human: 1,
  deny: 2,
} as const;

const noAuthoritativeError = Symbol("no-authoritative-error");

export function classifyCommandShadow(
  authoritativeDecision: "allow" | "deny",
  shadowDecision: EnforcementDecision["decision"],
): CommandShadowDivergence {
  const authoritativeStrictness = decisionStrictness[authoritativeDecision];
  const shadowStrictness = decisionStrictness[shadowDecision];
  if (shadowStrictness === authoritativeStrictness) return "none";
  return shadowStrictness > authoritativeStrictness ? "stricter" : "MORE_PERMISSIVE";
}

function writeWorkerStructuredLog(entry: CommandEnforcementShadowLog): void {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function safelyLog(logger: ShadowLogger, entry: CommandEnforcementShadowLog): void {
  try {
    logger(entry);
  } catch {
    // Shadow telemetry must never affect the authoritative worker path.
  }
}

function copyCommand(command: AllowedCommand): { readonly executable: string; args: string[] } {
  return { args: [...command.args], executable: command.executable };
}

function legacyAllowsRuntimeCommand(
  runtime: WorkerRuntime,
  phase: "bootstrap" | "validate",
  gnuTools: readonly string[],
  command: AllowedCommand,
): boolean {
  try {
    authorizeRuntimeCommands(
      {
        ...runtime,
        [phase]: [copyCommand(command)],
      },
      phase,
      gnuTools,
    );
    return true;
  } catch {
    return false;
  }
}

function legacyAllowsSpecificationCommand(
  assignment: WorkerAssignment,
  command: AllowedCommand,
): boolean {
  const runtime: WorkerRuntime = {
    allowed_commands: assignment.allowed_commands.map(copyCommand),
    bootstrap: [copyCommand(command)],
    forbidden_commands: [],
    package_manager: "custom",
    timeout_minutes: 1,
    validate: [],
  };
  return legacyAllowsRuntimeCommand(
    runtime,
    "bootstrap",
    assignment.required_tools.gnu_tools,
    command,
  );
}

function observeCommand(
  command: AllowedCommand,
  allowedCommands: readonly AllowedCommand[],
  forbiddenCommands: readonly AllowedCommand[],
  gnuTools: readonly string[],
  authoritativeDecision: "allow" | "deny",
  options: CommandShadowOptions,
): void {
  const logger = options.log ?? writeWorkerStructuredLog;
  try {
    const shadow = (options.decide ?? decideEnforcement)({
      action: "execute_command",
      allowedCommands,
      changedPaths: [],
      command,
      forbiddenCommands,
      gnuOnlyExecutables: GNU_ONLY_EXECUTABLES,
      gnuTools,
      protectedGlobs: [],
    });
    const divergence = classifyCommandShadow(authoritativeDecision, shadow.decision);
    safelyLog(logger, {
      authoritativeDecision,
      decision: shadow.decision,
      decisionHash: shadow.decisionHash,
      divergence,
      event: "worker.command_enforcement_shadow.evaluated",
      executable: command.executable,
      executionId: options.executionId,
      inputHash: shadow.inputHash,
      level: divergence === "MORE_PERMISSIVE" ? "error" : "info",
      reasonCode: shadow.reasonCode,
      service: "worker",
      taskId: options.taskId,
    });
  } catch {
    safelyLog(logger, {
      event: "worker.command_enforcement_shadow.failed",
      executable: command.executable,
      executionId: options.executionId,
      level: "error",
      service: "worker",
      taskId: options.taskId,
    });
  }
}

export function authorizeCommandsWithShadow(
  assignment: WorkerAssignment,
  options: CommandShadowOptions,
): readonly AllowedCommand[] {
  let authoritativeResult: readonly AllowedCommand[] | undefined;
  let authoritativeError: unknown = noAuthoritativeError;
  try {
    authoritativeResult = authorizeCommands(assignment);
  } catch (error) {
    authoritativeError = error;
  }

  try {
    const commands = assignment.specification.allowed_commands.map(parseSpecificationCommand);
    for (const command of commands) {
      observeCommand(
        command,
        assignment.allowed_commands,
        [],
        assignment.required_tools.gnu_tools,
        authoritativeError === noAuthoritativeError
          ? "allow"
          : legacyAllowsSpecificationCommand(assignment, command)
            ? "allow"
            : "deny",
        options,
      );
    }
  } catch {
    safelyLog(options.log ?? writeWorkerStructuredLog, {
      event: "worker.command_enforcement_shadow.failed",
      executionId: options.executionId,
      level: "error",
      service: "worker",
      taskId: options.taskId,
    });
  }

  if (authoritativeError !== noAuthoritativeError) throw authoritativeError;
  return authoritativeResult ?? [];
}

export function authorizeRuntimeCommandsWithShadow(
  runtime: WorkerRuntime,
  phase: "bootstrap" | "validate",
  gnuTools: readonly string[],
  options: CommandShadowOptions,
): readonly AllowedCommand[] {
  let authoritativeResult: readonly AllowedCommand[] | undefined;
  let authoritativeError: unknown = noAuthoritativeError;
  try {
    authoritativeResult = authorizeRuntimeCommands(runtime, phase, gnuTools);
  } catch (error) {
    authoritativeError = error;
  }

  for (const command of runtime[phase]) {
    observeCommand(
      command,
      runtime.allowed_commands,
      runtime.forbidden_commands,
      gnuTools,
      authoritativeError === noAuthoritativeError
        ? "allow"
        : legacyAllowsRuntimeCommand(runtime, phase, gnuTools, command)
          ? "allow"
          : "deny",
      options,
    );
  }

  if (authoritativeError !== noAuthoritativeError) throw authoritativeError;
  return authoritativeResult ?? [];
}
