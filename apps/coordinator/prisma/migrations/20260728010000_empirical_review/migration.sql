CREATE TYPE "EmpiricalReviewVerdict" AS ENUM ('PASS', 'FAIL', 'UNAVAILABLE');

CREATE TABLE "empirical_reviews" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "specification_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewer_id" TEXT NOT NULL,
  "verdict" "EmpiricalReviewVerdict" NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "reviewed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "empirical_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empirical_reviews_execution_id_key"
  ON "empirical_reviews"("execution_id");
CREATE UNIQUE INDEX "empirical_reviews_idempotency_key_key"
  ON "empirical_reviews"("idempotency_key");
CREATE UNIQUE INDEX "empirical_reviews_execution_id_version_key"
  ON "empirical_reviews"("execution_id", "version");
CREATE INDEX "empirical_reviews_task_id_created_at_idx"
  ON "empirical_reviews"("task_id", "created_at");
CREATE INDEX "empirical_reviews_verdict_created_at_idx"
  ON "empirical_reviews"("verdict", "created_at");

ALTER TABLE "empirical_reviews"
  ADD CONSTRAINT "empirical_reviews_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "empirical_reviews"
  ADD CONSTRAINT "empirical_reviews_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "empirical_reviews"
  ADD CONSTRAINT "empirical_reviews_specification_id_fkey"
  FOREIGN KEY ("specification_id") REFERENCES "specifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_empirical_review_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'empirical_reviews are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "empirical_reviews_prevent_update"
  BEFORE UPDATE ON "empirical_reviews"
  FOR EACH ROW EXECUTE FUNCTION prevent_empirical_review_mutation();

CREATE TRIGGER "empirical_reviews_prevent_delete"
  BEFORE DELETE ON "empirical_reviews"
  FOR EACH ROW EXECUTE FUNCTION prevent_empirical_review_mutation();
