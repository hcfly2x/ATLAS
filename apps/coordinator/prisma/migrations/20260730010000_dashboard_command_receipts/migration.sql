CREATE TYPE "DashboardCommandReceiptStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TYPE "DashboardCommandType" AS ENUM ('CREATE_DEMAND', 'CANCEL_TASK');

CREATE TABLE "dashboard_command_receipts" (
    "idempotency_key" TEXT NOT NULL,
    "command_type" "DashboardCommandType" NOT NULL,
    "request_hash" TEXT NOT NULL,
    "actor" "AuditActor" NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "requested_project" TEXT,
    "target_task_id" TEXT,
    "expected_version" INTEGER,
    "status" "DashboardCommandReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "result_code" TEXT,
    "result_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_command_receipts_pkey" PRIMARY KEY ("idempotency_key")
);

CREATE INDEX "dashboard_command_receipts_status_created_at_idx"
ON "dashboard_command_receipts"("status", "created_at");
