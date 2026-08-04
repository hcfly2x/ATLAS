CREATE TYPE "TaskPauseOrigin" AS ENUM ('WAITING_APPROVAL', 'QUEUED');

ALTER TABLE "tasks"
  ADD COLUMN "paused_from_state" "TaskPauseOrigin",
  ADD COLUMN "priority" SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_priority_allowed"
    CHECK ("priority" IN (0, 10, 20)),
  ADD CONSTRAINT "tasks_paused_origin_consistent"
    CHECK (
      ("state" = 'PAUSED' AND "paused_from_state" IS NOT NULL)
      OR ("state" <> 'PAUSED' AND "paused_from_state" IS NULL)
    );

CREATE INDEX "tasks_state_priority_created_at_id_idx"
  ON "tasks" ("state", "priority" DESC, "created_at", "id");
