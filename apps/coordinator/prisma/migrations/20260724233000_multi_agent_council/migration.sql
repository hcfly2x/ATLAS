CREATE TYPE "DeliberationStatus" AS ENUM ('RUNNING', 'COMPLETED');

CREATE TABLE "deliberations" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "status" "DeliberationStatus" NOT NULL DEFAULT 'RUNNING',
    "divergence_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "deliberations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deliberations_round_check" CHECK ("round" IN (1, 2))
);

CREATE TABLE "agent_opinions" (
    "id" TEXT NOT NULL,
    "deliberation_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "estimated_cost_usd" DECIMAL(12,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_opinions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_opinions_tokens_nonnegative" CHECK (
      "input_tokens" >= 0 AND "output_tokens" >= 0 AND "estimated_cost_usd" >= 0
    )
);

CREATE UNIQUE INDEX "deliberations_task_id_round_key"
  ON "deliberations"("task_id", "round");
CREATE INDEX "deliberations_task_id_created_at_idx"
  ON "deliberations"("task_id", "created_at");
CREATE UNIQUE INDEX "agent_opinions_deliberation_id_agent_id_key"
  ON "agent_opinions"("deliberation_id", "agent_id");
CREATE INDEX "agent_opinions_agent_id_created_at_idx"
  ON "agent_opinions"("agent_id", "created_at");

ALTER TABLE "deliberations"
  ADD CONSTRAINT "deliberations_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_opinions"
  ADD CONSTRAINT "agent_opinions_deliberation_id_fkey"
  FOREIGN KEY ("deliberation_id") REFERENCES "deliberations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION atlas_agent_opinions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_opinions is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_opinions_prevent_update"
  BEFORE UPDATE ON "agent_opinions"
  FOR EACH ROW EXECUTE FUNCTION atlas_agent_opinions_append_only();

CREATE TRIGGER "agent_opinions_prevent_delete"
  BEFORE DELETE ON "agent_opinions"
  FOR EACH ROW EXECUTE FUNCTION atlas_agent_opinions_append_only();
