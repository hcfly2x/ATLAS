import {
  decideEnforcement,
  type EnforcementDecision,
  type EnforcementInput,
  type EnforcementReasonCode,
} from "@atlas/core";
import type { WorkerAssignment, WorkerRuntime } from "@atlas/shared";

import {
  CommandNotAllowedError,
  GNU_ONLY_EXECUTABLES,
  authorizeRuntimeCommands,
  parseSpecificationCommand,
  type AllowedCommand,
} from "./allowlist.js";

export type CommandEnforcementDivergence = "none" | "stricter" | "MORE_PERMISSIVE";
export type CommandEnforcementSource =
  "deterministic" | "deterministic_failure" | "legacy_fallback";

export interface CommandEnforcementEvaluation {
  readonly decision: "allow" | "deny";
  readonly decisionHash?: string;
  readonly deterministicDecision?: EnforcementDecision["decision"];
  readonly divergence: CommandEnforcementDivergence;
  readonly inputHash?: string;
  readonly reasonCode: EnforcementReasonCode | "deterministic_failure" | "legacy_fallback";
  readonly source: CommandEnforcementSource;
}

export type CommandEnforcementLog =
  | {
      readonly decision: CommandEnforcementEvaluation["decision"];
      readonly decisionHash?: string;
      readonly deterministicDecision?: EnforcementDecision["decision"];
      readonly divergence: CommandEnforcementDivergence;
      readonly event: "worker.command_enforcement.evaluated";
      readonly executable: string;
      readonly executionId: string;
      readonly inputHash?: string;
      readonly level: "error" | "info";
      readonly legacyDecision: "allow" | "deny" | "unavailable";
      readonly reasonCode: CommandEnforcementEvaluation["reasonCode"];
      readonly service: "worker";
      readonly source: CommandEnforcementSource;
      readonly taskId: string;
    }
  | {
      readonly event: "worker.command_enforcement.failed";
      readonly executable?: string;
      readonly executionId: string;
      readonly level: "error";
      readonly service: "worker";
      readonly taskId: string;
    };

type DeterministicDecision = Pick<
  EnforcementDecision,
  "decision" | "decisionHash" | "inputHash" | "reasonCode"
>;
type EnforcementDecider = (input: EnforcementInput) => DeterministicDecision;
type EnforcementLogger = (entry: CommandEnforcementLog) => void;
type LegacyDecision = "allow" | "deny" | "unavailable";

export interface CommandEnforcementOptions {
  readonly decide?: EnforcementDecider;
  readonly executionId: string;
  readonly log?: EnforcementLogger;
  readonly taskId: string;
}

const decisionStrictness = {
  allow: 0,
  require_human: 1,
  deny: 2,
} as const;

export function classifyCommandEnforcementDivergence(
  authoritativeDecision: "allow" | "deny",
  deterministicDecision: EnforcementDecision["decision"],
): CommandEnforcementDivergence {
  const authoritativeStrictness = decisionStrictness[authoritativeDecision];
  const deterministicStrictness = decisionStrictness[deterministicDecision];
  if (deterministicStrictness === authoritativeStrictness) return "none";
  return deterministicStrictness > authoritativeStrictness ? "stricter" : "MORE_PERMISSIVE";
}

function writeWorkerStructuredLog(entry: CommandEnforcementLog): void {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function safelyLog(logger: EnforcementLogger, entry: CommandEnforcementLog): void {
  try {
    logger(entry);
  } catch {
    // Telemetry must never change the effective enforcement decision.
  }
}

function copyCommand(command: AllowedCommand): { readonly executable: string; args: string[] } {
  return { args: [...command.args], executable: command.executable };
}

function observeLegacy(authorize: () => unknown): LegacyDecision {
  try {
    authorize();
    return "allow";
  } catch (error) {
    return error instanceof CommandNotAllowedError ? "deny" : "unavailable";
  }
}

function legacyRuntimeDecision(
  runtime: WorkerRuntime,
  phase: "bootstrap" | "validate",
  gnuTools: readonly string[],
  command: AllowedCommand,
): LegacyDecision {
  return observeLegacy(() =>
    authorizeRuntimeCommands(
      {
        ...runtime,
        [phase]: [copyCommand(command)],
      },
      phase,
      gnuTools,
    ),
  );
}

function legacySpecificationDecision(
  assignment: WorkerAssignment,
  command: AllowedCommand,
): LegacyDecision {
  const runtime: WorkerRuntime = {
    allowed_commands: assignment.allowed_commands.map(copyCommand),
    bootstrap: [copyCommand(command)],
    forbidden_commands: [],
    package_manager: "custom",
    timeout_minutes: 1,
    validate: [],
  };
  return legacyRuntimeDecision(runtime, "bootstrap", assignment.required_tools.gnu_tools, command);
}

function evaluatedLog(
  command: AllowedCommand,
  legacyDecision: LegacyDecision,
  evaluation: CommandEnforcementEvaluation,
  options: CommandEnforcementOptions,
): CommandEnforcementLog {
  return {
    decision: evaluation.decision,
    ...(evaluation.decisionHash === undefined ? {} : { decisionHash: evaluation.decisionHash }),
    ...(evaluation.deterministicDecision === undefined
      ? {}
      : { deterministicDecision: evaluation.deterministicDecision }),
    divergence: evaluation.divergence,
    event: "worker.command_enforcement.evaluated",
    executable: command.executable,
    executionId: options.executionId,
    ...(evaluation.inputHash === undefined ? {} : { inputHash: evaluation.inputHash }),
    level:
      evaluation.source !== "deterministic" || evaluation.divergence === "MORE_PERMISSIVE"
        ? "error"
        : "info",
    legacyDecision,
    reasonCode: evaluation.reasonCode,
    service: "worker",
    source: evaluation.source,
    taskId: options.taskId,
  };
}

export function evaluateCommandEnforcement(
  command: AllowedCommand,
  allowedCommands: readonly AllowedCommand[],
  forbiddenCommands: readonly AllowedCommand[],
  gnuTools: readonly string[],
  legacyDecision: LegacyDecision,
  options: CommandEnforcementOptions,
): CommandEnforcementEvaluation {
  const logger = options.log ?? writeWorkerStructuredLog;
  try {
    const deterministic = (options.decide ?? decideEnforcement)({
      action: "execute_command",
      allowedCommands,
      changedPaths: [],
      command,
      forbiddenCommands,
      gnuOnlyExecutables: GNU_ONLY_EXECUTABLES,
      gnuTools,
      protectedGlobs: [],
    });
    const divergence =
      legacyDecision === "unavailable"
        ? "none"
        : classifyCommandEnforcementDivergence(legacyDecision, deterministic.decision);
    const evaluation: CommandEnforcementEvaluation =
      divergence === "MORE_PERMISSIVE"
        ? {
            decision: "deny",
            decisionHash: deterministic.decisionHash,
            deterministicDecision: deterministic.decision,
            divergence,
            inputHash: deterministic.inputHash,
            reasonCode: "legacy_fallback",
            source: "legacy_fallback",
          }
        : {
            decision: deterministic.decision === "allow" ? "allow" : "deny",
            decisionHash: deterministic.decisionHash,
            deterministicDecision: deterministic.decision,
            divergence,
            inputHash: deterministic.inputHash,
            reasonCode: deterministic.reasonCode,
            source: "deterministic",
          };
    safelyLog(logger, evaluatedLog(command, legacyDecision, evaluation, options));
    return evaluation;
  } catch {
    const evaluation: CommandEnforcementEvaluation = {
      decision: "deny",
      divergence: legacyDecision === "allow" ? "stricter" : "none",
      reasonCode: "deterministic_failure",
      source: "deterministic_failure",
    };
    safelyLog(logger, evaluatedLog(command, legacyDecision, evaluation, options));
    return evaluation;
  }
}

export class CommandEnforcementDeniedError extends Error {
  readonly code = "COMMAND_NOT_ALLOWED";

  constructor(readonly evaluation: CommandEnforcementEvaluation) {
    super(`Command denied by deterministic enforcement: ${evaluation.reasonCode}`);
    this.name = "CommandEnforcementDeniedError";
  }
}

function assertCommandAllowed(evaluation: CommandEnforcementEvaluation): void {
  if (evaluation.decision !== "allow") throw new CommandEnforcementDeniedError(evaluation);
}

function logParsingFailure(options: CommandEnforcementOptions): void {
  safelyLog(options.log ?? writeWorkerStructuredLog, {
    event: "worker.command_enforcement.failed",
    executionId: options.executionId,
    level: "error",
    service: "worker",
    taskId: options.taskId,
  });
}

export function authorizeCommandsWithEnforcement(
  assignment: WorkerAssignment,
  options: CommandEnforcementOptions,
): readonly AllowedCommand[] {
  let commands: readonly AllowedCommand[];
  try {
    commands = assignment.specification.allowed_commands.map(parseSpecificationCommand);
  } catch (error) {
    logParsingFailure(options);
    throw error;
  }
  return commands.map((command) => {
    const evaluation = evaluateCommandEnforcement(
      command,
      assignment.allowed_commands,
      [],
      assignment.required_tools.gnu_tools,
      legacySpecificationDecision(assignment, command),
      options,
    );
    assertCommandAllowed(evaluation);
    return copyCommand(command);
  });
}

export function authorizeRuntimeCommandsWithEnforcement(
  runtime: WorkerRuntime,
  phase: "bootstrap" | "validate",
  gnuTools: readonly string[],
  options: CommandEnforcementOptions,
): readonly AllowedCommand[] {
  return runtime[phase].map((command) => {
    const evaluation = evaluateCommandEnforcement(
      command,
      runtime.allowed_commands,
      runtime.forbidden_commands,
      gnuTools,
      legacyRuntimeDecision(runtime, phase, gnuTools, command),
      options,
    );
    assertCommandAllowed(evaluation);
    return copyCommand(command);
  });
}
