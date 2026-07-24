CREATE TYPE "MemoryType" AS ENUM ('DECISION', 'SUMMARY', 'NOTE');

CREATE TABLE "memory_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "MemoryType" NOT NULL,
    "content" TEXT NOT NULL,
    "task_id" TEXT,
    "agent_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memory_items_content_nonempty" CHECK (length(btrim("content")) > 0),
    CONSTRAINT "memory_items_summary_task" CHECK ("type" <> 'SUMMARY' OR "task_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "memory_items_idempotency_key_key" ON "memory_items"("idempotency_key");
CREATE INDEX "memory_items_project_id_created_at_idx" ON "memory_items"("project_id", "created_at");
CREATE INDEX "memory_items_project_id_type_created_at_idx" ON "memory_items"("project_id", "type", "created_at");
CREATE INDEX "memory_items_task_id_created_at_idx" ON "memory_items"("task_id", "created_at");

ALTER TABLE "memory_items"
  ADD CONSTRAINT "memory_items_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memory_items"
  ADD CONSTRAINT "memory_items_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_memory_item_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'memory_items is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "memory_items_prevent_update"
BEFORE UPDATE ON "memory_items"
FOR EACH ROW EXECUTE FUNCTION prevent_memory_item_mutation();

CREATE TRIGGER "memory_items_prevent_delete"
BEFORE DELETE ON "memory_items"
FOR EACH ROW EXECUTE FUNCTION prevent_memory_item_mutation();
