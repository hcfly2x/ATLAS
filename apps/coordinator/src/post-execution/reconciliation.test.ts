import { describe, expect, it } from "vitest";

import { reconcileQaSignals } from "./reconciliation.js";

describe("reconcileQaSignals", () => {
  it.each([
    {
      empiricalVerdict: "pass",
      expected: ["approved", "qa_signals_approved", true],
      reviewerDecision: "approved",
    },
    {
      empiricalVerdict: "fail",
      expected: ["rejected", "qa_empirical_failed", false],
      reviewerDecision: "approved",
    },
    {
      empiricalVerdict: "unavailable",
      expected: ["rejected", "qa_empirical_unavailable", false],
      reviewerDecision: "approved",
    },
    {
      empiricalVerdict: "pass",
      expected: ["rejected", "qa_reviewer_rejected", false],
      reviewerDecision: "rejected",
    },
    {
      empiricalVerdict: "fail",
      expected: ["rejected", "qa_reviewer_rejected", false],
      reviewerDecision: "rejected",
    },
  ] as const)(
    "reconciles $empiricalVerdict + $reviewerDecision without bypassing the Approval gate",
    ({ empiricalVerdict, expected, reviewerDecision }) => {
      const result = reconcileQaSignals({ empiricalVerdict, reviewerDecision });
      expect([result.outcome, result.reasonCode, result.releasesApprovalGate]).toEqual(expected);
    },
  );

  it.each([
    {
      empiricalVerdict: null,
      expected: "qa_empirical_signal_missing",
      reviewerDecision: "approved",
    },
    {
      empiricalVerdict: "pass",
      expected: "qa_reviewer_signal_missing",
      reviewerDecision: null,
    },
  ] as const)("fails closed when a signal is missing", (input) => {
    expect(reconcileQaSignals(input)).toEqual({
      outcome: "failed",
      reasonCode: input.expected,
      releasesApprovalGate: false,
    });
  });

  it("is deterministic and does not mutate its input", () => {
    const input = Object.freeze({
      empiricalVerdict: "pass" as const,
      reviewerDecision: "approved" as const,
    });
    expect(reconcileQaSignals(input)).toEqual(reconcileQaSignals(input));
    expect(input).toEqual({ empiricalVerdict: "pass", reviewerDecision: "approved" });
  });
});
