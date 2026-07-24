ALTER TABLE "executions"
ADD COLUMN "result_hash" TEXT,
ADD COLUMN "result_payload" JSONB,
ADD COLUMN "result_sequence" INTEGER,
ADD COLUMN "finalization_idempotency_key" TEXT,
ADD COLUMN "finalization_hash" TEXT,
ADD COLUMN "reconciled_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "executions_finalization_idempotency_key_key"
ON "executions"("finalization_idempotency_key");

CREATE TABLE "worker_log_chunks" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_log_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_log_chunks_idempotency_key_key"
ON "worker_log_chunks"("idempotency_key");
CREATE UNIQUE INDEX "worker_log_chunks_execution_id_sequence_key"
ON "worker_log_chunks"("execution_id", "sequence");
CREATE INDEX "worker_log_chunks_execution_id_created_at_idx"
ON "worker_log_chunks"("execution_id", "created_at");

CREATE TABLE "codex_usages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "estimated_cost_usd" DECIMAL(12,8) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codex_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "codex_usages_execution_id_key" ON "codex_usages"("execution_id");
CREATE INDEX "codex_usages_created_at_idx" ON "codex_usages"("created_at");
CREATE INDEX "codex_usages_project_id_created_at_idx"
ON "codex_usages"("project_id", "created_at");

ALTER TABLE "worker_log_chunks"
ADD CONSTRAINT "worker_log_chunks_execution_id_fkey"
FOREIGN KEY ("execution_id") REFERENCES "executions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "codex_usages"
ADD CONSTRAINT "codex_usages_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "codex_usages"
ADD CONSTRAINT "codex_usages_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "codex_usages"
ADD CONSTRAINT "codex_usages_execution_id_fkey"
FOREIGN KEY ("execution_id") REFERENCES "executions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
