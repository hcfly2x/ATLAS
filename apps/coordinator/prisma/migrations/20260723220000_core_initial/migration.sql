-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'FUTURE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('NEW', 'NORMALIZING', 'ROUTING', 'SPECIFYING', 'WAITING_APPROVAL', 'QUEUED', 'RUNNING', 'TESTING', 'WAITING_RESULT_APPROVAL', 'FINALIZING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskComplexity" AS ENUM ('SIMPLE', 'MODERATE', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('PRE_EXECUTION', 'RESULT', 'SENSITIVE_ACTION');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalTargetType" AS ENUM ('SPECIFICATION', 'EXECUTION_RESULT', 'SENSITIVE_ACTION');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'TESTING', 'AWAITING_RESULT_APPROVAL', 'FINALIZING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('OFFLINE', 'IDLE', 'BUSY', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('USER', 'AGENT', 'WORKER', 'SYSTEM');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "data_classification" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "repository" TEXT,
    "protected_paths_profile" TEXT NOT NULL,
    "allowed_commands" JSONB NOT NULL,
    "required_tools" JSONB NOT NULL,
    "task_cost_limit_usd" DECIMAL(10,2),
    "retention" JSONB NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "original_message" TEXT NOT NULL,
    "normalized_demand" JSONB,
    "complexity" "TaskComplexity",
    "state" "TaskState" NOT NULL DEFAULT 'NEW',
    "failure_stage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "active_specification_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specifications" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "target_type" "ApprovalTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_version" INTEGER,
    "target_hash" TEXT NOT NULL,
    "presented_payload" JSONB NOT NULL,
    "requested_by" TEXT NOT NULL,
    "decided_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "specification_id" TEXT NOT NULL,
    "worker_id" TEXT,
    "attempt" INTEGER NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "branch" TEXT,
    "worktree" TEXT,
    "commands" JSONB,
    "exit_codes" JSONB,
    "logs_ref" TEXT,
    "diff_summary" JSONB,
    "diff_hash" TEXT,
    "test_result" JSONB,
    "failure_stage" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "lease_id" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "claim_idempotency_key" TEXT,
    "result_idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "project_scopes" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "concurrency_limit" INTEGER NOT NULL DEFAULT 1,
    "last_heartbeat_at" TIMESTAMP(3),
    "status" "WorkerStatus" NOT NULL DEFAULT 'OFFLINE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "actor" "AuditActor" NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_idempotency_key_key" ON "tasks"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_active_specification_id_key" ON "tasks"("active_specification_id");

-- CreateIndex
CREATE INDEX "tasks_project_id_state_idx" ON "tasks"("project_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "specifications_task_id_version_key" ON "specifications"("task_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "specifications_task_id_payload_hash_key" ON "specifications"("task_id", "payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_idempotency_key_key" ON "approvals"("idempotency_key");

-- CreateIndex
CREATE INDEX "approvals_task_id_status_idx" ON "approvals"("task_id", "status");

-- CreateIndex
CREATE INDEX "approvals_target_type_target_id_idx" ON "approvals"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "executions_idempotency_key_key" ON "executions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "executions_lease_id_key" ON "executions"("lease_id");

-- CreateIndex
CREATE UNIQUE INDEX "executions_claim_idempotency_key_key" ON "executions"("claim_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "executions_result_idempotency_key_key" ON "executions"("result_idempotency_key");

-- CreateIndex
CREATE INDEX "executions_status_lease_expires_at_idx" ON "executions"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "executions_task_id_attempt_key" ON "executions"("task_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "workers_token_hash_key" ON "workers"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_idempotency_key_key" ON "audit_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "audit_events_project_id_created_at_idx" ON "audit_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_task_id_created_at_idx" ON "audit_events"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_active_specification_id_fkey" FOREIGN KEY ("active_specification_id") REFERENCES "specifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specifications" ADD CONSTRAINT "specifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "specifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce append-only audit history at the database boundary.
CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_reject_update
BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER audit_events_reject_delete
BEFORE DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

-- Specification versions are immutable once persisted.
CREATE FUNCTION reject_specification_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'specifications are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER specifications_reject_update
BEFORE UPDATE ON "specifications"
FOR EACH ROW EXECUTE FUNCTION reject_specification_mutation();

CREATE TRIGGER specifications_reject_delete
BEFORE DELETE ON "specifications"
FOR EACH ROW EXECUTE FUNCTION reject_specification_mutation();
