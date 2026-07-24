import { PrismaClient } from "@prisma/client";

import { createCoordinatorApp } from "./app.js";
import { PrismaTaskCoreStore } from "./core/prisma-task-core-store.js";
import { TelegramBotApiClient } from "./telegram/client.js";
import { startTelegramPolling } from "./telegram/polling.js";
import { TelegramGateway } from "./telegram/service.js";
import { PrismaTelegramStore } from "./telegram/store.js";

const prisma = new PrismaClient();
const taskStore = new PrismaTaskCoreStore(prisma);
const internalAuthToken = process.env.INTERNAL_API_TOKEN;
if (internalAuthToken === undefined || internalAuthToken.length === 0) {
  throw new Error("INTERNAL_API_TOKEN is required");
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramAllowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID;
const telegramEnabled = telegramToken !== undefined && telegramAllowedUserId !== undefined;
const telegramClient = telegramEnabled ? new TelegramBotApiClient(telegramToken) : undefined;
const telegramGateway = telegramEnabled
  ? new TelegramGateway({
      allowedUserId: BigInt(telegramAllowedUserId),
      store: new PrismaTelegramStore(prisma),
      taskStore,
    })
  : undefined;
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const telegramWebhookEnabled =
  telegramClient !== undefined &&
  telegramGateway !== undefined &&
  telegramWebhookSecret !== undefined &&
  telegramWebhookSecret.trim().length > 0;
const app = createCoordinatorApp({
  internalAuthToken,
  logger: true,
  taskStore,
  ...(telegramWebhookEnabled ? { telegramClient, telegramGateway, telegramWebhookSecret } : {}),
});
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";

app.addHook("onClose", async () => prisma.$disconnect());

const polling =
  process.env.TELEGRAM_MODE === "polling" &&
  telegramClient !== undefined &&
  telegramGateway !== undefined
    ? startTelegramPolling(telegramGateway, telegramClient, app.log)
    : undefined;
app.addHook("onClose", () => {
  polling?.stop();
});

try {
  await app.listen({ host, port });
} catch (error: unknown) {
  app.log.error({ error }, "coordinator failed to start");
  process.exitCode = 1;
  await app.close();
}
