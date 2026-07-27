import {
  decideEnforcement,
  type EnforcementDecision,
  type EnforcementInput,
  type EnforcementReasonCode,
} from "@atlas/core";
import { canonicalPayloadHash } from "@atlas/shared";

import { findProtectedPathMatches } from "./protected-paths.js";

export type ProtectedPathDivergence = "none" | "stricter" | "MORE_PERMISSIVE";

export type ProtectedPathEnforcementSource = "deterministic" | "empty_diff" | "legacy_fallback";

export interface ProtectedPathEvaluation {
  readonly decision: EnforcementDecision["decision"];
  readonly decisionHash?: string;
  readonly divergence: ProtectedPathDivergence;
  readonly inputHash?: string;
  readonly matches: readonly string[];
  readonly reasonCode: EnforcementReasonCode | "empty_diff" | "legacy_fallback";
  readonly source: ProtectedPathEnforcementSource;
}

export type ProtectedPathEnforcementLog =
  | {
      readonly authoritativeDecision: "allow" | "require_human" | "unavailable";
      readonly decision: EnforcementDecision["decision"];
      readonly decisionHash?: string;
      readonly divergence: ProtectedPathDivergence;
      readonly event: "worker.protected_path_enforcement.evaluated";
      readonly executionId: string;
      readonly inputHash?: string;
      readonly level: "error" | "info";
      readonly reasonCode: ProtectedPathEvaluation["reasonCode"];
      readonly service: "worker";
      readonly source: ProtectedPathEnforcementSource;
      readonly taskId: string;
    }
  | {
      readonly event: "worker.protected_path_enforcement.failed";
      readonly executionId: string;
      readonly level: "error";
      readonly service: "worker";
      readonly taskId: string;
    };

type DeterministicDecision = Pick<
  EnforcementDecision,
  "decision" | "decisionHash" | "evidence" | "inputHash" | "reasonCode"
>;
type EnforcementDecider = (input: EnforcementInput) => DeterministicDecision;
type LegacyMatcher = (
  changedPaths: readonly string[],
  protectedGlobs: readonly string[],
) => readonly string[];
type EnforcementLogger = (entry: ProtectedPathEnforcementLog) => void;

const decisionStrictness = {
  allow: 0,
  require_human: 1,
  deny: 2,
} as const;

export function classifyProtectedPathDivergence(
  authoritativeDecision: "allow" | "require_human",
  deterministicDecision: EnforcementDecision["decision"],
): ProtectedPathDivergence {
  const authoritativeStrictness = decisionStrictness[authoritativeDecision];
  const deterministicStrictness = decisionStrictness[deterministicDecision];
  if (deterministicStrictness === authoritativeStrictness) return "none";
  return deterministicStrictness > authoritativeStrictness ? "stricter" : "MORE_PERMISSIVE";
}

function writeWorkerStructuredLog(entry: ProtectedPathEnforcementLog): void {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function safelyLog(logger: EnforcementLogger, entry: ProtectedPathEnforcementLog): void {
  try {
    logger(entry);
  } catch {
    // Local telemetry must never affect enforcement, finalization or the lease.
  }
}

function legacyDecision(matches: readonly string[]): "allow" | "require_human" {
  return matches.length > 0 ? "require_human" : "allow";
}

function conservativeDeniedMatches(changedPaths: readonly string[]): readonly string[] {
  const unique = [...new Set(changedPaths)].sort();
  return unique.length > 0 ? unique : ["<invalid-path>"];
}

function resultFromLegacy(
  legacyMatches: readonly string[],
  divergence: ProtectedPathDivergence,
): ProtectedPathEvaluation {
  return {
    decision: legacyDecision(legacyMatches),
    divergence,
    matches: [...legacyMatches],
    reasonCode: "legacy_fallback",
    source: "legacy_fallback",
  };
}

function evaluatedLog(
  evaluation: ProtectedPathEvaluation,
  authoritativeDecision: "allow" | "require_human" | "unavailable",
  executionId: string,
  taskId: string,
): ProtectedPathEnforcementLog {
  return {
    authoritativeDecision,
    decision: evaluation.decision,
    ...(evaluation.decisionHash === undefined ? {} : { decisionHash: evaluation.decisionHash }),
    divergence: evaluation.divergence,
    event: "worker.protected_path_enforcement.evaluated",
    executionId,
    ...(evaluation.inputHash === undefined ? {} : { inputHash: evaluation.inputHash }),
    level:
      evaluation.source === "legacy_fallback" || evaluation.divergence === "MORE_PERMISSIVE"
        ? "error"
        : "info",
    reasonCode: evaluation.reasonCode,
    service: "worker",
    source: evaluation.source,
    taskId,
  };
}

function emptyDiffEvaluation(protectedGlobs: readonly string[]): ProtectedPathEvaluation {
  const input = {
    action: "open_pull_request",
    changedPaths: [],
    protectedGlobs: [...new Set(protectedGlobs)].sort(),
    rule: "empty_diff_has_no_path_to_protect",
  };
  const inputHash = canonicalPayloadHash(input);
  return {
    decision: "allow",
    decisionHash: canonicalPayloadHash({
      decision: "allow",
      input,
      inputHash,
      reasonCode: "empty_diff",
    }),
    divergence: "none",
    inputHash,
    matches: [],
    reasonCode: "empty_diff",
    source: "empty_diff",
  };
}

export class ProtectedPathEnforcementDeniedError extends Error {
  constructor(readonly evaluation: ProtectedPathEvaluation) {
    super(`Protected path enforcement denied: ${evaluation.reasonCode}`);
    this.name = "ProtectedPathEnforcementDeniedError";
  }
}

export function assertProtectedPathEnforcementAllowsResult(
  evaluation: ProtectedPathEvaluation,
): void {
  if (evaluation.decision === "deny") {
    throw new ProtectedPathEnforcementDeniedError(evaluation);
  }
}

export function evaluateProtectedPaths(
  changedPaths: readonly string[],
  protectedGlobs: readonly string[],
  options: {
    readonly decide?: EnforcementDecider;
    readonly executionId: string;
    readonly legacyMatch?: LegacyMatcher;
    readonly log?: EnforcementLogger;
    readonly taskId: string;
  },
): ProtectedPathEvaluation {
  const logger = options.log ?? writeWorkerStructuredLog;
  if (changedPaths.length === 0) {
    const evaluation = emptyDiffEvaluation(protectedGlobs);
    safelyLog(logger, evaluatedLog(evaluation, "allow", options.executionId, options.taskId));
    return evaluation;
  }

  let authoritativeMatches: readonly string[] | undefined;
  try {
    authoritativeMatches = (options.legacyMatch ?? findProtectedPathMatches)(
      changedPaths,
      protectedGlobs,
    );
  } catch {
    authoritativeMatches = undefined;
  }
  const authoritativeDecision =
    authoritativeMatches === undefined ? "unavailable" : legacyDecision(authoritativeMatches);

  try {
    const deterministic = (options.decide ?? decideEnforcement)({
      action: "open_pull_request",
      allowedCommands: [],
      changedPaths,
      forbiddenCommands: [],
      protectedGlobs,
    });
    const divergence =
      authoritativeDecision === "unavailable"
        ? "none"
        : classifyProtectedPathDivergence(authoritativeDecision, deterministic.decision);
    const deterministicEvaluation: ProtectedPathEvaluation = {
      decision: deterministic.decision,
      decisionHash: deterministic.decisionHash,
      divergence,
      inputHash: deterministic.inputHash,
      matches:
        deterministic.decision === "require_human"
          ? [...deterministic.evidence.protectedPaths]
          : deterministic.decision === "deny"
            ? conservativeDeniedMatches(changedPaths)
            : [],
      reasonCode: deterministic.reasonCode,
      source: "deterministic",
    };
    const evaluation =
      divergence === "MORE_PERMISSIVE" && authoritativeMatches !== undefined
        ? resultFromLegacy(authoritativeMatches, divergence)
        : deterministicEvaluation;
    safelyLog(
      logger,
      evaluatedLog(evaluation, authoritativeDecision, options.executionId, options.taskId),
    );
    return evaluation;
  } catch {
    if (authoritativeMatches !== undefined) {
      const evaluation = resultFromLegacy(authoritativeMatches, "none");
      safelyLog(
        logger,
        evaluatedLog(evaluation, authoritativeDecision, options.executionId, options.taskId),
      );
      return evaluation;
    }
    safelyLog(logger, {
      event: "worker.protected_path_enforcement.failed",
      executionId: options.executionId,
      level: "error",
      service: "worker",
      taskId: options.taskId,
    });
    return {
      decision: "deny",
      divergence: "stricter",
      matches: conservativeDeniedMatches(changedPaths),
      reasonCode: "invalid_input",
      source: "deterministic",
    };
  }
}
