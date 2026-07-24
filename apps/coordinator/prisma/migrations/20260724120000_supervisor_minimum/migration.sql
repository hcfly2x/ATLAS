-- CreateEnum
CREATE TYPE "ApprovalActor" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ApprovalChannel" AS ENUM ('TELEGRAM', 'POLICY');

-- AlterTable
ALTER TABLE "projects"
ADD COLUMN "autonomy_level" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "projects"
ADD CONSTRAINT "projects_autonomy_level_check"
CHECK ("autonomy_level" BETWEEN 0 AND 4);

-- AlterTable
ALTER TABLE "approvals"
ADD COLUMN "actor" "ApprovalActor" NOT NULL DEFAULT 'USER';

ALTER TABLE "approvals"
ALTER COLUMN "channel" TYPE "ApprovalChannel"
USING UPPER("channel")::"ApprovalChannel";

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "estimated_cost_usd" DECIMAL(12,8) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls"("created_at");

CREATE INDEX "llm_calls_project_id_created_at_idx" ON "llm_calls"("project_id", "created_at");

CREATE INDEX "llm_calls_task_id_created_at_idx" ON "llm_calls"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "llm_calls"
ADD CONSTRAINT "llm_calls_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "llm_calls"
ADD CONSTRAINT "llm_calls_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
