import { decideEnforcement, type EnforcementDecision, type EnforcementInput } from "@atlas/core";

import { findProtectedPathMatches } from "./protected-paths.js";

export type ShadowDivergence = "none" | "stricter" | "MORE_PERMISSIVE";

export type ProtectedPathShadowLog =
  | {
      readonly authoritativeDecision: "allow" | "require_human";
      readonly decision: EnforcementDecision["decision"];
      readonly decisionHash: string;
      readonly divergence: ShadowDivergence;
      readonly event: "worker.protected_path_shadow.evaluated";
      readonly executionId: string;
      readonly inputHash: string;
      readonly level: "error" | "info";
      readonly reasonCode: EnforcementDecision["reasonCode"];
      readonly service: "worker";
      readonly taskId: string;
    }
  | {
      readonly event: "worker.protected_path_shadow.failed";
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
type ShadowLogger = (entry: ProtectedPathShadowLog) => void;

const decisionStrictness = {
  allow: 0,
  require_human: 1,
  deny: 2,
} as const;

export function classifyProtectedPathShadow(
  authoritativeDecision: "allow" | "require_human",
  shadowDecision: EnforcementDecision["decision"],
): ShadowDivergence {
  const authoritativeStrictness = decisionStrictness[authoritativeDecision];
  const shadowStrictness = decisionStrictness[shadowDecision];
  if (shadowStrictness === authoritativeStrictness) return "none";
  return shadowStrictness > authoritativeStrictness ? "stricter" : "MORE_PERMISSIVE";
}

function writeWorkerStructuredLog(entry: ProtectedPathShadowLog): void {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function safelyLog(logger: ShadowLogger, entry: ProtectedPathShadowLog): void {
  try {
    logger(entry);
  } catch {
    // Shadow telemetry must never affect the authoritative worker path.
  }
}

export function findProtectedPathMatchesWithShadow(
  changedPaths: readonly string[],
  protectedGlobs: readonly string[],
  options: {
    readonly decide?: ShadowDecider;
    readonly executionId: string;
    readonly log?: ShadowLogger;
    readonly taskId: string;
  },
): readonly string[] {
  const authoritativeMatches = findProtectedPathMatches(changedPaths, protectedGlobs);
  const authoritativeDecision = authoritativeMatches.length > 0 ? "require_human" : "allow";
  const logger = options.log ?? writeWorkerStructuredLog;

  try {
    const shadow = (options.decide ?? decideEnforcement)({
      action: "open_pull_request",
      allowedCommands: [],
      changedPaths,
      forbiddenCommands: [],
      protectedGlobs,
    });
    const divergence = classifyProtectedPathShadow(authoritativeDecision, shadow.decision);
    safelyLog(logger, {
      authoritativeDecision,
      decision: shadow.decision,
      decisionHash: shadow.decisionHash,
      divergence,
      event: "worker.protected_path_shadow.evaluated",
      executionId: options.executionId,
      inputHash: shadow.inputHash,
      level: divergence === "MORE_PERMISSIVE" ? "error" : "info",
      reasonCode: shadow.reasonCode,
      service: "worker",
      taskId: options.taskId,
    });
  } catch {
    safelyLog(logger, {
      event: "worker.protected_path_shadow.failed",
      executionId: options.executionId,
      level: "error",
      service: "worker",
      taskId: options.taskId,
    });
  }

  return authoritativeMatches;
}
