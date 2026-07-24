ALTER TABLE "telegram_task_deliveries"
  ADD COLUMN "result_delivery_key" TEXT,
  ADD COLUMN "result_claimed_at" TIMESTAMP(3),
  ADD COLUMN "result_delivered_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "telegram_task_deliveries_result_delivery_key_key"
  ON "telegram_task_deliveries"("result_delivery_key");
