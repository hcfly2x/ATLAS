export type EmpiricalQaSignal = "fail" | "pass" | "unavailable";
export type ReviewerQaSignal = "approved" | "rejected";

export type QaReconciliationReason =
  | "qa_empirical_failed"
  | "qa_empirical_signal_missing"
  | "qa_empirical_unavailable"
  | "qa_reviewer_rejected"
  | "qa_reviewer_signal_missing"
  | "qa_signals_approved";

export interface QaReconciliation {
  readonly outcome: "approved" | "failed" | "rejected";
  readonly reasonCode: QaReconciliationReason;
  readonly releasesApprovalGate: boolean;
}

export function reconcileQaSignals(input: {
  readonly empiricalVerdict: EmpiricalQaSignal | null;
  readonly reviewerDecision: ReviewerQaSignal | null;
}): QaReconciliation {
  if (input.empiricalVerdict === null) {
    return {
      outcome: "failed",
      reasonCode: "qa_empirical_signal_missing",
      releasesApprovalGate: false,
    };
  }
  if (input.reviewerDecision === null) {
    return {
      outcome: "failed",
      reasonCode: "qa_reviewer_signal_missing",
      releasesApprovalGate: false,
    };
  }
  if (input.reviewerDecision === "rejected") {
    return {
      outcome: "rejected",
      reasonCode: "qa_reviewer_rejected",
      releasesApprovalGate: false,
    };
  }
  if (input.empiricalVerdict === "fail") {
    return {
      outcome: "rejected",
      reasonCode: "qa_empirical_failed",
      releasesApprovalGate: false,
    };
  }
  if (input.empiricalVerdict === "unavailable") {
    return {
      outcome: "rejected",
      reasonCode: "qa_empirical_unavailable",
      releasesApprovalGate: false,
    };
  }
  return {
    outcome: "approved",
    reasonCode: "qa_signals_approved",
    releasesApprovalGate: true,
  };
}
