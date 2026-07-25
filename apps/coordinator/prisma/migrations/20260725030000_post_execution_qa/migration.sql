CREATE TYPE "PostExecutionReviewStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'APPROVED',
  'REJECTED',
  'FAILED'
);

CREATE TABLE "post_execution_reviews" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "specification_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewer_id" TEXT NOT NULL,
  "model" TEXT,
  "status" "PostExecutionReviewStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "payload_hash" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "claim_token" TEXT,
  "claim_expires_at" TIMESTAMP(3),
  "failure_reason" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "post_execution_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "post_execution_reviews_execution_id_key"
  ON "post_execution_reviews"("execution_id");
CREATE UNIQUE INDEX "post_execution_reviews_idempotency_key_key"
  ON "post_execution_reviews"("idempotency_key");
CREATE UNIQUE INDEX "post_execution_reviews_execution_id_version_key"
  ON "post_execution_reviews"("execution_id", "version");
CREATE INDEX "post_execution_reviews_status_claim_expires_at_idx"
  ON "post_execution_reviews"("status", "claim_expires_at");
CREATE INDEX "post_execution_reviews_task_id_created_at_idx"
  ON "post_execution_reviews"("task_id", "created_at");

ALTER TABLE "post_execution_reviews"
  ADD CONSTRAINT "post_execution_reviews_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "post_execution_reviews"
  ADD CONSTRAINT "post_execution_reviews_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "post_execution_reviews"
  ADD CONSTRAINT "post_execution_reviews_specification_id_fkey"
  FOREIGN KEY ("specification_id") REFERENCES "specifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_final_post_execution_review_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'REJECTED', 'FAILED') THEN
    RAISE EXCEPTION 'final post_execution_reviews are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION prevent_post_execution_review_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'post_execution_reviews cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "post_execution_reviews_prevent_final_update"
  BEFORE UPDATE ON "post_execution_reviews"
  FOR EACH ROW EXECUTE FUNCTION prevent_final_post_execution_review_mutation();

CREATE TRIGGER "post_execution_reviews_prevent_delete"
  BEFORE DELETE ON "post_execution_reviews"
  FOR EACH ROW EXECUTE FUNCTION prevent_post_execution_review_delete();
