CREATE TYPE "PostExecutionReviewerDecision" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "post_execution_reviews"
  ADD COLUMN "empirical_verdict" "EmpiricalReviewVerdict",
  ADD COLUMN "reviewer_decision" "PostExecutionReviewerDecision",
  ADD COLUMN "reconciliation_reason" TEXT;

ALTER TABLE "post_execution_reviews"
  ADD CONSTRAINT "post_execution_reviews_reconciliation_reason_check"
  CHECK (
    "reconciliation_reason" IS NULL
    OR "reconciliation_reason" IN (
      'qa_empirical_failed',
      'qa_empirical_signal_missing',
      'qa_empirical_unavailable',
      'qa_reviewer_rejected',
      'qa_reviewer_signal_missing',
      'qa_signals_approved'
    )
  );
