-- CreateTable
CREATE TABLE "telegram_sessions" (
    "user_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "selected_project_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "update_id" BIGINT NOT NULL,
    "callback_id" TEXT,
    "user_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "response" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("update_id")
);

-- CreateIndex
CREATE INDEX "telegram_sessions_selected_project_id_idx" ON "telegram_sessions"("selected_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_callback_id_key" ON "telegram_updates"("callback_id");

-- AddForeignKey
ALTER TABLE "telegram_sessions" ADD CONSTRAINT "telegram_sessions_selected_project_id_fkey"
FOREIGN KEY ("selected_project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
