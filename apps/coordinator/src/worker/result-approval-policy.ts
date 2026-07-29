import type { TaskComplexity } from "@atlas/shared";

export const resultApprovalReasonCodes = {
  autonomyLevelRequiresHuman: "autonomy_level_requires_human",
  criticalRiskEvalGateClosed: "critical_risk_eval_gate_closed",
  empiricalEvidenceNotPassed: "empirical_evidence_not_passed",
  policyAutoApproved: "policy_auto_approved",
  protectedPathsChanged: "protected_paths_changed",
  sensitiveActionDeclared: "sensitive_action_declared",
  testsNotGreen: "tests_not_green",
} as const;

export type ResultApprovalReasonCode =
  (typeof resultApprovalReasonCodes)[keyof typeof resultApprovalReasonCodes];

export interface ResultApprovalPolicyInput {
  readonly approvalRequiredFor: readonly string[];
  readonly autonomyLevel: number;
  readonly empiricalVerdict: "fail" | "pass" | "unavailable";
  readonly protectedPathMatches: readonly string[];
  readonly riskLevel: TaskComplexity;
  readonly testsGreen: boolean;
}

export interface ResultApprovalPolicyDecision {
  readonly actor: "SYSTEM" | "USER";
  readonly reasonCode: ResultApprovalReasonCode;
}

export function decideResultApproval(
  input: ResultApprovalPolicyInput,
): ResultApprovalPolicyDecision {
  if (input.empiricalVerdict !== "pass") {
    return { actor: "USER", reasonCode: resultApprovalReasonCodes.empiricalEvidenceNotPassed };
  }
  if (!input.testsGreen) {
    return { actor: "USER", reasonCode: resultApprovalReasonCodes.testsNotGreen };
  }
  if (input.protectedPathMatches.length > 0) {
    return { actor: "USER", reasonCode: resultApprovalReasonCodes.protectedPathsChanged };
  }
  if (input.approvalRequiredFor.length > 0) {
    return { actor: "USER", reasonCode: resultApprovalReasonCodes.sensitiveActionDeclared };
  }
  if (input.autonomyLevel < 2 || input.autonomyLevel > 3) {
    return { actor: "USER", reasonCode: resultApprovalReasonCodes.autonomyLevelRequiresHuman };
  }
  if (input.riskLevel === "critical") {
    return { actor: "USER", reasonCode: resultApprovalReasonCodes.criticalRiskEvalGateClosed };
  }
  return { actor: "SYSTEM", reasonCode: resultApprovalReasonCodes.policyAutoApproved };
}
