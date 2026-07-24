ALTER TABLE "telegram_sessions"
ADD COLUMN "verbose_level" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "telegram_sessions"
ADD CONSTRAINT "telegram_sessions_verbose_level_check"
CHECK ("verbose_level" BETWEEN 0 AND 2);

CREATE TABLE "telegram_task_deliveries" (
  "task_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" BIGINT NOT NULL,
  "chat_id" BIGINT NOT NULL,
  "last_task_version" INTEGER NOT NULL DEFAULT -1,
  "last_log_sequence" INTEGER NOT NULL DEFAULT -1,
  "last_log_offset" INTEGER NOT NULL DEFAULT 0,
  "last_activity_at" TIMESTAMP(3),
  "final_delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_task_deliveries_pkey" PRIMARY KEY ("task_id")
);

CREATE INDEX "telegram_task_deliveries_project_id_updated_at_idx"
ON "telegram_task_deliveries"("project_id", "updated_at");

ALTER TABLE "telegram_task_deliveries"
ADD CONSTRAINT "telegram_task_deliveries_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "telegram_task_deliveries"
ADD CONSTRAINT "telegram_task_deliveries_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
