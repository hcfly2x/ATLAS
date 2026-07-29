import { describe, expect, it } from "vitest";

import {
  decideResultApproval,
  resultApprovalReasonCodes,
  type ResultApprovalPolicyInput,
} from "./result-approval-policy.js";

const eligible: ResultApprovalPolicyInput = {
  approvalRequiredFor: [],
  autonomyLevel: 2,
  empiricalVerdict: "pass",
  protectedPathMatches: [],
  riskLevel: "moderate",
  testsGreen: true,
};

describe("decideResultApproval", () => {
  it.each([
    {
      change: { empiricalVerdict: "fail" as const },
      reasonCode: resultApprovalReasonCodes.empiricalEvidenceNotPassed,
    },
    {
      change: { empiricalVerdict: "unavailable" as const },
      reasonCode: resultApprovalReasonCodes.empiricalEvidenceNotPassed,
    },
    {
      change: { testsGreen: false },
      reasonCode: resultApprovalReasonCodes.testsNotGreen,
    },
    {
      change: { protectedPathMatches: [".env.local"] },
      reasonCode: resultApprovalReasonCodes.protectedPathsChanged,
    },
    {
      change: { approvalRequiredFor: ["merge_main"] },
      reasonCode: resultApprovalReasonCodes.sensitiveActionDeclared,
    },
    {
      change: { autonomyLevel: 1 },
      reasonCode: resultApprovalReasonCodes.autonomyLevelRequiresHuman,
    },
    {
      change: { autonomyLevel: 4 },
      reasonCode: resultApprovalReasonCodes.autonomyLevelRequiresHuman,
    },
    {
      change: { autonomyLevel: 3, riskLevel: "critical" as const },
      reasonCode: resultApprovalReasonCodes.criticalRiskEvalGateClosed,
    },
  ])("fails closed for $reasonCode", ({ change, reasonCode }) => {
    expect(decideResultApproval({ ...eligible, ...change })).toEqual({
      actor: "USER",
      reasonCode,
    });
  });

  it.each([
    { autonomyLevel: 2, riskLevel: "simple" as const },
    { autonomyLevel: 2, riskLevel: "moderate" as const },
    { autonomyLevel: 3, riskLevel: "simple" as const },
    { autonomyLevel: 3, riskLevel: "moderate" as const },
  ])(
    "allows policy approval for reversible $riskLevel work at level $autonomyLevel",
    ({ autonomyLevel, riskLevel }) => {
      expect(decideResultApproval({ ...eligible, autonomyLevel, riskLevel })).toEqual({
        actor: "SYSTEM",
        reasonCode: resultApprovalReasonCodes.policyAutoApproved,
      });
    },
  );

  it("is deterministic and does not mutate its input", () => {
    const input = structuredClone(eligible);
    const snapshot = structuredClone(input);

    expect(decideResultApproval(input)).toEqual(decideResultApproval(input));
    expect(input).toEqual(snapshot);
  });

  it("keeps every critical result human while the eval gate is closed", () => {
    for (const autonomyLevel of [0, 1, 2, 3, 4]) {
      expect(
        decideResultApproval({ ...eligible, autonomyLevel, riskLevel: "critical" }).actor,
      ).toBe("USER");
    }
  });
});
