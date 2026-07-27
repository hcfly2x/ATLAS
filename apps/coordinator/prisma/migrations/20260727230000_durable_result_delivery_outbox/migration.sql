CREATE TYPE "DeliveryOutboxStatus" AS ENUM (
  'PENDING',
  'DELIVERED',
  'DELIVERY_FAILED'
);

CREATE TABLE "result_delivery_outbox" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "task_version" INTEGER NOT NULL,
  "delivery_key" TEXT NOT NULL,
  "destination_user_id" BIGINT NOT NULL,
  "destination_chat_id" BIGINT NOT NULL,
  "content_reference" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "message_text" TEXT NOT NULL,
  "status" "DeliveryOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatch_started_at" TIMESTAMP(3),
  "dispatch_claim_expires_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "result_delivery_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "result_delivery_outbox_attempts_nonnegative"
    CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "result_delivery_outbox_delivery_key_key"
  ON "result_delivery_outbox"("delivery_key");
CREATE UNIQUE INDEX "result_delivery_outbox_task_id_task_version_key"
  ON "result_delivery_outbox"("task_id", "task_version");
CREATE INDEX "result_delivery_outbox_status_next_attempt_at_idx"
  ON "result_delivery_outbox"("status", "next_attempt_at");
CREATE INDEX "result_delivery_outbox_project_id_created_at_idx"
  ON "result_delivery_outbox"("project_id", "created_at");

ALTER TABLE "result_delivery_outbox"
  ADD CONSTRAINT "result_delivery_outbox_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "result_delivery_outbox"
  ADD CONSTRAINT "result_delivery_outbox_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
